import http from 'node:http';
import { AddressInfo } from 'node:net';

export interface MockServerOptions {
  validSessionId?: string;
  validUsername?: string;
  validPassword?: string;
  csrfToken?: string;
}

export function createValidMinimalPdf(): Buffer {
  const minPdf = `%PDF-1.4
1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj
2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj
3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >> endobj
4 0 obj << /Length 55 >> stream
BT
/F1 24 Tf
100 700 Td
(PESU Circular Test Content) Tj
ET
endstream
endobj
5 0 obj << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> endobj
xref
0 6
0000000000 65535 f 
0000000009 00000 n 
0000000058 00000 n 
0000000115 00000 n 
0000000244 00000 n 
0000000350 00000 n 
trailer << /Size 6 /Root 1 0 R >>
startxref
423
%%EOF`;
  return Buffer.from(minPdf);
}

export class MockPesuServer {
  public server: http.Server;
  public port: number = 0;
  public baseUrl: string = '';
  public options: MockServerOptions;
  public requests: Array<{ method: string; url: string; headers: http.IncomingHttpHeaders; body: string }> = [];

  // Scenarios to toggle edge cases dynamically
  public sessionExpiredOnce: boolean = false;
  public emptySemesters: boolean = false;
  public emptyAttendance: boolean = false;
  public zeroAttendance: boolean = false;
  public malformedAttendance: boolean = false;
  public emptyResults: boolean = false;
  public missingGpaResults: boolean = false;
  public duplicateSubjectResults: boolean = false;
  public emptyAnnouncements: boolean = false;
  public malformedTimetableScript: boolean = false;
  public emptyCourses: boolean = false;
  public emptyCourseUnits: boolean = false;
  public emptyUnitTopics: boolean = false;
  public emptyTopicDocs: boolean = false;
  public hallTicketReleased: boolean = true;
  public backlogAvailable: boolean = true;
  public returnInvalidPdf: boolean = false;

  constructor(options: MockServerOptions = {}) {
    this.options = {
      validSessionId: 'valid_mock_session_12345',
      validUsername: 'PES1202200000',
      validPassword: 'Password123',
      csrfToken: 'mock_csrf_token_xyz987',
      ...options,
    };

    this.server = http.createServer(async (req, res) => {
      let body = '';
      for await (const chunk of req) {
        body += chunk;
      }
      const record = {
        method: req.method || 'GET',
        url: req.url || '/',
        headers: req.headers,
        body,
      };
      this.requests.push(record);

      const urlObj = new URL(req.url || '/', `http://127.0.0.1:${this.port}`);
      const pathname = urlObj.pathname;
      const cookie = req.headers['cookie'] || '';
      const hasValidSession = cookie.includes(`JSESSIONID=${this.options.validSessionId}`);
      const csrf = req.headers['x-csrf-token'];

      // Scenario: simulate session expiration retry on first AJAX call
      if (this.sessionExpiredOnce && pathname.includes('/Academy/s/')) {
        this.sessionExpiredOnce = false;
        res.writeHead(401, { 'Content-Type': 'text/plain' });
        res.end('Session Expired');
        return;
      }

      // 1. Initial Login page
      if (pathname === '/Academy/' || pathname === '/Academy') {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(`
          <html>
            <head><meta name="csrf-token" content="initial_login_csrf_abc123" /></head>
            <body>
              <form id="loginForm" action="/Academy/j_spring_security_check" method="POST">
                <input type="hidden" name="_csrf" value="initial_login_csrf_abc123" />
                <input type="text" name="j_username" />
                <input type="password" name="j_password" />
              </form>
            </body>
          </html>
        `);
        return;
      }

      // 2. Spring Security Login POST
      if (pathname === '/Academy/j_spring_security_check') {
        const params = new URLSearchParams(body);
        const u = params.get('j_username');
        const p = params.get('j_password');
        if (u === this.options.validUsername && p === this.options.validPassword) {
          res.writeHead(302, {
            Location: '/Academy/s/studentProfilePESU',
            'Set-Cookie': `JSESSIONID=${this.options.validSessionId}; Path=/Academy; HttpOnly`,
          });
          res.end();
        } else {
          // Invalid credentials return login page with error
          res.writeHead(200, { 'Content-Type': 'text/html' });
          res.end('<html><body><div id="postloginform">Sign in Invalid Credentials</div></body></html>');
        }
        return;
      }

      // 3. Profile / CSRF check (/Academy/s/studentProfilePESU)
      if (pathname === '/Academy/s/studentProfilePESU') {
        if (!hasValidSession) {
          res.writeHead(200, { 'Content-Type': 'text/html' });
          res.end('<html><body><div id="postloginform">Sign in</div></body></html>');
          return;
        }
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(`
          <html>
            <head><meta name="csrf-token" content="${this.options.csrfToken}" /></head>
            <body>
              <div id="studentProfile">Welcome Student</div>
            </body>
          </html>
        `);
        return;
      }

      // 4. Semester list
      if (pathname === '/Academy/s/studentProfile/getStudentSemestersPESU') {
        if (!hasValidSession) {
          res.writeHead(401, { 'Content-Type': 'text/plain' });
          res.end('Unauthorized');
          return;
        }
        if (this.emptySemesters) {
          res.writeHead(200, { 'Content-Type': 'text/html' });
          res.end('<select id="semesters"></select>');
          return;
        }
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(`
          <select id="semesters">
            <option value="3199">Sem-6</option>
            <option value="2915">Sem-5</option>
            <option value="2610">Sem-4</option>
          </select>
        `);
        return;
      }

      // 5. studentProfilePESUAdmin Dispatcher
      if (pathname === '/Academy/s/studentProfilePESUAdmin' || pathname === '/Academy/s/studentProfileAdmin') {
        const params = req.method === 'POST' ? new URLSearchParams(body) : urlObj.searchParams;
        const controllerMode = params.get('controllerMode');
        const actionType = params.get('actionType');
        const menuId = params.get('menuId');

        // Attendance (mode 6407, action 8, menu 660)
        if (controllerMode === '6407' && actionType === '8') {
          if (this.emptyAttendance) {
            res.writeHead(200, { 'Content-Type': 'text/html' });
            res.end('<table><tbody></tbody></table>');
            return;
          }
          if (this.zeroAttendance) {
            res.writeHead(200, { 'Content-Type': 'text/html' });
            res.end(`
              <table><tbody>
                <tr>
                  <td>UE23CS351A</td>
                  <td>Database Management Systems</td>
                  <td>0/0</td>
                  <td>0.00</td>
                </tr>
              </tbody></table>
            `);
            return;
          }
          if (this.malformedAttendance) {
            res.writeHead(200, { 'Content-Type': 'text/html' });
            res.end(`
              <table><tbody>
                <tr>
                  <td>UE23CS352A</td>
                  <td>Compiler Design</td>
                  <td>N/A</td>
                  <td>--</td>
                </tr>
                <tr>
                  <td>Too few cells</td>
                </tr>
              </tbody></table>
            `);
            return;
          }
          // Normal Attendance response
          res.writeHead(200, { 'Content-Type': 'text/html' });
          res.end(`
            <table><tbody>
              <tr>
                <td>UE23CS351A</td>
                <td>Database Management Systems</td>
                <td>35/40</td>
                <td>87.50</td>
              </tr>
              <tr>
                <td>UE23CS352A</td>
                <td>Computer Networks</td>
                <td>20/40</td>
                <td>50.00</td>
              </tr>
            </tbody></table>
          `);
          return;
        }

        // Results (mode 6402, action 9, menu 652)
        if (controllerMode === '6402' && actionType === '9') {
          if (this.emptyResults) {
            res.writeHead(200, { 'Content-Type': 'text/html' });
            res.end('<div class="panel-body">No results found</div>');
            return;
          }
          if (this.missingGpaResults) {
            res.writeHead(200, { 'Content-Type': 'text/html' });
            res.end(`
              <div class="panel-body">
                <div>UE23CS351A - Database Systems Credits: 4 ISA 45.0 ESA S</div>
              </div>
            `);
            return;
          }
          if (this.duplicateSubjectResults) {
            res.writeHead(200, { 'Content-Type': 'text/html' });
            res.end(`
              <div class="panel-body">
                SGPA: 8.92  CGPA: 8.75  Earned Credits: 24/24
                <div class="row">UE23CS351A - Database Systems Credits: 4 ISA 45.0 ESA S</div>
                <div class="row">UE23CS351A - Database Systems Credits: 4 ISA 45.0 ESA S</div>
              </div>
            `);
            return;
          }
          // Normal results
          res.writeHead(200, { 'Content-Type': 'text/html' });
          res.end(`
            <div class="panel-body">
              <div>SGPA : 9.15</div>
              <div>CGPA : 8.85</div>
              <div>Earned Credits : 22/22</div>
              <div class="row">UE23CS351A - Database Management Systems Credits: 4.0 ISA 48 ESA S</div>
              <div class="row">UE23CS352A - Operating Systems Credits: 4.0 ISA 42 ESA A</div>
            </div>
          `);
          return;
        }

        // Announcements list (mode 6411, action 5, menu 667)
        if (controllerMode === '6411' && actionType === '5') {
          if (this.emptyAnnouncements) {
            res.writeHead(200, { 'Content-Type': 'text/html' });
            res.end('<div class="container"></div>');
            return;
          }
          res.writeHead(200, { 'Content-Type': 'text/html' });
          res.end(`
            <div class="elem-info-wrapper">
              <span class="text-date">25-Sep-2026</span>
              <h4><a onclick="handleShowMoreAnnouncement(1, 2, 7466)">Midterm Schedule Released</a></h4>
              <p>The Midterm exams schedule has been published.</p>
              <a href="handleDownloadAnoncemntdoc('6040')">Circular_Timetable.pdf</a>
            </div>
            <div class="elem-info-wrapper">
              <span class="text-date">20-Sep-2026</span>
              <h4><a onclick="handleShowMoreAnnouncement(1, 2, 7465)">Campus Hackathon Registration</a></h4>
              <p>Register for PES Hackathon by Friday.</p>
            </div>
            <div class="elem-info-wrapper">
              <!-- Malformed without ID -->
              <h4>No Onclick Header</h4>
              <p>Broken item</p>
            </div>
          `);
          return;
        }

        // Announcement details (mode 6411, action 4)
        if (controllerMode === '6411' && actionType === '4') {
          const aid = params.get('AnnouncementId');
          res.writeHead(200, { 'Content-Type': 'text/html' });
          res.end(`
            <div class="elem-info-wrapper">
              <h4 class="text-info">Detailed Announcement ${aid}</h4>
              <span class="text-date">25-Sep-2026</span>
              <div class="panel-body">
                Full body text with important circular instructions for all students.
              </div>
              <a href="handleDownloadAnoncemntdoc('6040')">Circular_Timetable.pdf</a>
            </div>
          `);
          return;
        }

        // Timetable (mode 6415, action 5)
        if (controllerMode === '6415' && actionType === '5') {
          if (this.malformedTimetableScript) {
            res.writeHead(200, { 'Content-Type': 'text/html' });
            res.end(`
              <div>Class Name: CSE-6A Section: A</div>
              <script>
                var timeTableJson = [{ invalid: json }];
              </script>
            `);
            return;
          }
          res.writeHead(200, { 'Content-Type': 'text/html' });
          res.end(`
            <div>Class Name: CSE-6A Section: A</div>
            <script>
              var timeTableJson = [{"day": "Monday", "period": 1, "subject": "DBMS", "room": "B301"}];
              var timeTableTemplateDetailsJson = {"template": "Regular"};
              function handleTimeTable() {}
            </script>
          `);
          return;
        }

        // Courses (mode 6403, action 38)
        if (controllerMode === '6403' && actionType === '38') {
          if (this.emptyCourses) {
            res.writeHead(200, { 'Content-Type': 'text/html' });
            res.end('<table><tbody></tbody></table>');
            return;
          }
          res.writeHead(200, { 'Content-Type': 'text/html' });
          res.end(`
            <table><tbody>
              <tr onclick="clickOnCourseContent('20970')">
                <td>UE23CS351A</td>
                <td>Database Systems</td>
                <td>Theory</td>
                <td>Active</td>
              </tr>
              <tr onclick="clickOnCourseContent('20971')">
                <td>UE23CS352A</td>
                <td>Machine Learning</td>
                <td>Theory</td>
                <td>Active</td>
              </tr>
              <tr>
                <td>UE23CS353A</td>
                <td>No Onclick Course</td>
                <td>Practical</td>
                <td>Active</td>
              </tr>
            </tbody></table>
          `);
          return;
        }

        // Course Units (mode 6403, action 42)
        if (controllerMode === '6403' && actionType === '42') {
          if (this.emptyCourseUnits) {
            res.writeHead(200, { 'Content-Type': 'text/html' });
            res.end('<h4>Database Systems</h4><div>No units</div>');
            return;
          }
          res.writeHead(200, { 'Content-Type': 'text/html' });
          res.end(`
            <h4>Database Systems</h4>
            <a onclick="handleclassUnit('62019')">Unit 1 - Relational Model</a>
            <a onclick="handleclassUnit('62020')">Unit 2 - SQL and Normalization</a>
          `);
          return;
        }

        // Unit Topics (mode 6403, action 43)
        if (controllerMode === '6403' && actionType === '43') {
          if (this.emptyUnitTopics) {
            res.writeHead(200, { 'Content-Type': 'text/html' });
            res.end('<table><tbody></tbody></table>');
            return;
          }
          res.writeHead(200, { 'Content-Type': 'text/html' });
          res.end(`
            <table><tbody>
              <tr>
                <td>Topic 1: ER Modeling</td>
                <td>
                  <a onclick="handleclasscoursecontentunit('U101', 'SUB201', 'CC301', '1', 10, event)">2</a>
                  <a onclick="handleclasscoursecontentunit('U101', 'SUB201', 'CC301', '1', 1, event)">1</a>
                  <a onclick="handleclasscoursecontentunit('U101', 'SUB201', 'CC301', '1', 5, event)">1</a>
                  <a onclick="handleclasscoursecontentunit('U101', 'SUB201', 'CC301', '1', 6, event)">3</a>
                </td>
              </tr>
            </tbody></table>
          `);
          return;
        }

        // Topic Documents (mode 6403, action 60)
        if (controllerMode === '6403' && actionType === '60') {
          if (this.emptyTopicDocs) {
            res.writeHead(200, { 'Content-Type': 'text/html' });
            res.end('<div>No documents</div>');
            return;
          }
          res.writeHead(200, { 'Content-Type': 'text/html' });
          res.end(`
            <div>
              <a onclick="loadIframe('ER Diagram Slides', 'doc_uuid_1111')">Slide Deck 1</a>
              <a onclick="loadIframe('Normalization Cheatsheet', 'doc_uuid_2222')">Slide Deck 2</a>
            </div>
          `);
          return;
        }

        // Assignments (mode 6591, action 5)
        if (controllerMode === '6591' && actionType === '5') {
          res.writeHead(200, { 'Content-Type': 'text/html' });
          res.end(`
            <table><tbody>
              <tr>
                <td>Assignment 1</td>
                <td>Homework</td>
                <td>DBMS</td>
                <td>01-Sep-2026</td>
                <td>15-Sep-2026</td>
                <td>Submitted</td>
                <td>Evaluated</td>
                <td>10</td>
                <td>10</td>
              </tr>
            </tbody></table>
          `);
          return;
        }

        // Seating Info (mode 6404, action 5)
        if (controllerMode === '6404' && actionType === '5') {
          res.writeHead(200, { 'Content-Type': 'text/html' });
          res.end('<div>Room: G04, Desk: 42, Block: Golden Jubilee</div>');
          return;
        }

        // Student Profile (mode 6414, action 5)
        if (controllerMode === '6414' && actionType === '5') {
          res.writeHead(200, { 'Content-Type': 'text/html' });
          res.end(`
            <div class="col-md-6 form-group">
              <span class="lbl-title-light">SRN:</span>
              <span class="form-control-static">PES1UG22CS999</span>
            </div>
            <div class="col-md-6 form-group">
              <label>Name:</label>
              <p>Test Student</p>
            </div>
            <div>
              PUC Marks : 96.5%
              SSLC Marks : 95.0%
            </div>
          `);
          return;
        }

        // Calendar (mode 6413, action 5)
        if (controllerMode === '6413' && actionType === '5') {
          res.writeHead(200, { 'Content-Type': 'text/html' });
          res.end(`
            <div>
              October 02, 2026 Friday all-day Gandhi Jayanti Holiday
              November 01, 2026 Sunday all-day Kannada Rajyotsava Holiday
            </div>
          `);
          return;
        }

        // Quizzes (mode 6422, action 5)
        if (controllerMode === '6422' && actionType === '5') {
          res.writeHead(200, { 'Content-Type': 'text/html' });
          res.end(`
            <table id="currentTestId"><tbody>
              <tr>
                <td>CS351</td>
                <td>DBMS Quiz</td>
                <td>10:00 AM</td>
                <td>10:30 AM</td>
                <td>30 mins</td>
                <td>20</td>
                <td>20</td>
              </tr>
            </tbody></table>
            <table id="oldTestId"><tbody>
              <tr>
                <td>CS352</td>
                <td>OS Quiz</td>
                <td>02:00 PM</td>
                <td>02:30 PM</td>
                <td>30 mins</td>
                <td>15</td>
                <td>15</td>
              </tr>
            </tbody></table>
          `);
          return;
        }

        // Grievances (mode 6421, action 5)
        if (controllerMode === '6421' && actionType === '5') {
          res.writeHead(200, { 'Content-Type': 'text/html' });
          res.end(`
            <table><tbody>
              <tr>
                <td>1</td>
                <td>TKT-2026-001</td>
                <td>01-Sep-2026</td>
                <td>Hostel Wifi</td>
                <td>03-Sep-2026</td>
                <td>Resolved</td>
              </tr>
              <tr>
                <td>2</td>
                <td>No data available in table</td>
                <td></td>
                <td></td>
                <td></td>
                <td></td>
              </tr>
            </tbody></table>
          `);
          return;
        }

        // Backlog Status (mode 6419, action 5)
        if (controllerMode === '6419' && actionType === '5') {
          res.writeHead(200, { 'Content-Type': 'text/html' });
          if (this.backlogAvailable) {
            res.end('<div>Backlog exam fee payment link is active</div>');
          } else {
            res.end('<div>Backlog Registration is currently not available for your batch.</div>');
          }
          return;
        }
      }

      // 6. Hall Ticket Check
      if (pathname === '/Academy/s/studentProfile/getActioveBasedEsaId/244') {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        if (this.hallTicketReleased) {
          res.end(`
            <select>
              <option value="0">Select ESA</option>
              <option value="9924">ESA May-June 2026</option>
            </select>
          `);
        } else {
          res.end(`
            <select>
              <option value="0">Select ESA</option>
            </select>
          `);
        }
        return;
      }

      // 7. Download Hall Ticket PDF
      if (pathname.startsWith('/Academy/s/reports/Reports/downloadStudentHallTicket/')) {
        const parts = pathname.split('/');
        const esaId = parts[parts.length - 2];
        res.writeHead(200, {
          'Content-Type': 'application/pdf',
          'Content-Disposition': `attachment; filename="HallTicket_${esaId}.pdf"`,
        });
        res.end(createValidMinimalPdf());
        return;
      }

      // 8. Download Announcement Attachment
      if (pathname.startsWith('/Academy/s/studentProfilePESUAdmin/downloadAnoncemntdoc/')) {
        const docId = pathname.split('/').pop();
        if (this.returnInvalidPdf) {
          res.writeHead(200, { 'Content-Type': 'application/pdf' });
          res.end(Buffer.from('CORRUPTED_NOT_A_PDF'));
          return;
        }
        res.writeHead(200, {
          'Content-Type': 'application/pdf',
          'Content-Disposition': `attachment; filename="Circular_${docId}.pdf"`,
        });
        res.end(createValidMinimalPdf());
        return;
      }

      // 9. Download Course Material Slide/Note Doc
      if (pathname.startsWith('/Academy/a/referenceMeterials/downloadslidecoursedoc/')) {
        const docId = pathname.split('/').pop();
        res.writeHead(200, {
          'Content-Type': 'application/pdf',
          'Content-Disposition': `attachment; filename="Lecture_Slides_${docId}.pdf"`,
        });
        res.end(createValidMinimalPdf());
        return;
      }

      // Default 404
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Not Found: ' + pathname);
    });
  }

  public async start(): Promise<void> {
    return new Promise((resolve) => {
      this.server.listen(0, '127.0.0.1', () => {
        const addr = this.server.address() as AddressInfo;
        this.port = addr.port;
        this.baseUrl = `http://127.0.0.1:${this.port}`;
        resolve();
      });
    });
  }

  public async stop(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.server.close((err) => (err ? reject(err) : resolve()));
    });
  }
}
