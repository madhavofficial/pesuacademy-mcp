import axios, { AxiosInstance } from 'axios';
import { wrapper } from 'axios-cookiejar-support';
import { CookieJar } from 'tough-cookie';
import * as cheerio from 'cheerio';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

export interface PesuCredentials {
  username?: string;
  password?: string;
  sessionId?: string;
  baseUrl?: string;
}

export function resolveOutputDir(dir?: string): string {
  if (!dir || dir === './downloads') {
    return path.join(process.cwd(), 'downloads');
  }
  if (dir.startsWith('~/') || dir === '~') {
    return path.join(os.homedir(), dir.slice(1));
  }
  return path.resolve(dir);
}

export function sanitizeFilename(filename: string): string {
  // Remove illegal characters on Windows (< > : " / \ | ? *) and control characters
  let clean = filename.replace(/[<>:"/\\|?*\x00-\x1F]/g, '_');
  // Trim spaces and dots from ends (Windows restriction)
  clean = clean.trim().replace(/^\.+/, '').replace(/\.+$/, '');
  // Limit length to avoid MAX_PATH issues on Windows
  if (clean.length > 180) {
    const ext = path.extname(clean);
    clean = clean.slice(0, 175) + ext;
  }
  if (!clean || clean.replace(/[_.]/g, '').trim() === '') {
    return 'document.pdf';
  }
  return clean;
}

export class PesuClient {
  private jar: CookieJar;
  private client: AxiosInstance;
  private baseUrl = 'https://www.pesuacademy.com';
  private csrfToken: string = '';
  private credentials: PesuCredentials;

  constructor(creds: PesuCredentials = {}) {
    this.baseUrl = creds.baseUrl || process.env.PESU_BASE_URL || 'https://www.pesuacademy.com';
    this.credentials = {
      ...creds,
      sessionId: creds.sessionId || process.env.PESU_SESSION_ID,
    };
    this.jar = new CookieJar();
    const raw = axios.create({
      baseURL: this.baseUrl,
      withCredentials: true,
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
        Accept: '*/*',
        'Accept-Language': 'en-US,en;q=0.9',
      },
      maxRedirects: 10,
      timeout: 30000,
    } as any);
    (raw.defaults as any).jar = this.jar;
    this.client = wrapper(raw as any) as any;
  }

  public async authenticate(): Promise<boolean> {
    // 1. If sessionId cookie provided directly, test if it is valid
    if (this.credentials.sessionId) {
      await this.jar.setCookie(
        `JSESSIONID=${this.credentials.sessionId}; Path=/Academy`,
        this.baseUrl
      );
      const ok = await this.refreshCsrfToken();
      if (ok) return true;
      // If sessionId expired, clear it and fall back to username/password
      this.csrfToken = '';
    }

    // 2. Auto-login using username and password
    const username = this.credentials.username || process.env.PESU_USERNAME;
    const password = this.credentials.password || process.env.PESU_PASSWORD;

    if (!username || !password) {
      throw new Error(
        'Missing PESU credentials. Set PESU_USERNAME and PESU_PASSWORD in .env or environment.'
      );
    }

    // Fetch login page to get initial cookies and CSRF
    const loginPageRes = await this.client.get('/Academy/');
    const $ = cheerio.load(loginPageRes.data);
    const initialCsrf =
      $('input[name="_csrf"]').val() ||
      $('meta[name="csrf-token"]').attr('content') ||
      '';

    // Perform authentication request matching standard browser submission
    const params = new URLSearchParams();
    if (initialCsrf) {
      params.append('_csrf', initialCsrf as string);
    }
    params.append('j_username', username);
    params.append('j_password', password);

    const postHeaders: Record<string, string> = {
      'Content-Type': 'application/x-www-form-urlencoded',
      Origin: this.baseUrl,
      Referer: `${this.baseUrl}/Academy/`,
    };

    await this.client.post(
      '/Academy/j_spring_security_check',
      params.toString(),
      {
        headers: postHeaders,
        maxRedirects: 5,
        validateStatus: () => true, // accept redirects
      }
    );

    // Check if logged in by fetching studentProfilePESU
    return await this.refreshCsrfToken();
  }

  public async refreshCsrfToken(): Promise<boolean> {
    try {
      const res = await this.client.get('/Academy/s/studentProfilePESU', {
        validateStatus: () => true,
      });
      if (res.status === 200 && typeof res.data === 'string') {
        const $ = cheerio.load(res.data);
        // If login form is present, or redirected to login, we are NOT authenticated
        if (
          $('#postloginform').length > 0 ||
          $('#j_scriptusername').length > 0 ||
          res.data.includes('j_spring_security_check') ||
          res.data.includes('Sign in')
        ) {
          return false;
        }

        const token = $('meta[name="csrf-token"]').attr('content');
        if (token) {
          this.csrfToken = token;
          return true;
        }
      }
      return false;
    } catch {
      return false;
    }
  }

  private async ensureAuthenticated(): Promise<void> {
    if (!this.csrfToken) {
      const success = await this.authenticate();
      if (!success) {
        throw new Error('Authentication to PESU Academy failed. Check credentials.');
      }
    }
  }

  public async doAjax(
    endpoint: string,
    method: 'GET' | 'POST' = 'GET',
    data: Record<string, any> = {}
  ): Promise<string> {
    await this.ensureAuthenticated();

    const url = endpoint.startsWith('/') ? endpoint : `/Academy/s/${endpoint}`;
    const headers: Record<string, string> = {
      'X-CSRF-Token': this.csrfToken,
      'X-Requested-With': 'XMLHttpRequest',
      Referer: `${this.baseUrl}/Academy/s/studentProfilePESU`,
    };

    let res;
    if (method === 'POST') {
      const form = new URLSearchParams();
      for (const [k, v] of Object.entries(data)) {
        if (v !== undefined && v !== null) {
          form.append(k, String(v));
        }
      }
      headers['Content-Type'] = 'application/x-www-form-urlencoded';
      res = await this.client.post(url, form.toString(), {
        headers,
        validateStatus: () => true,
      });
    } else {
      res = await this.client.get(url, {
        headers,
        params: data,
        validateStatus: () => true,
      });
    }

    // Handle expired session / login redirect
    if (
      res.status === 401 ||
      (typeof res.data === 'string' &&
        (res.data.includes('j_spring_security_check') || res.data.includes('Sign in')))
    ) {
      // Re-authenticate and retry once
      this.csrfToken = '';
      await this.ensureAuthenticated();
      headers['X-CSRF-Token'] = this.csrfToken;
      if (method === 'POST') {
        const form = new URLSearchParams();
        for (const [k, v] of Object.entries(data)) {
          if (v !== undefined && v !== null) form.append(k, String(v));
        }
        res = await this.client.post(url, form.toString(), { headers });
      } else {
        res = await this.client.get(url, { headers, params: data });
      }
    }

    return typeof res.data === 'string' ? res.data : JSON.stringify(res.data);
  }

  // --- 1. My Attendance ---
  public async getSemesters(): Promise<Array<{ id: string; name: string }>> {
    const html = await this.doAjax('/Academy/s/studentProfile/getStudentSemestersPESU', 'GET');
    const $ = cheerio.load(html);
    const semesters: Array<{ id: string; name: string }> = [];
    $('option').each((_, el) => {
      const val = $(el).val();
      const txt = $(el).text().trim();
      if (val) semesters.push({ id: String(val), name: txt });
    });
    return semesters;
  }

  public async getAttendance(semId?: string): Promise<{
    semester: string;
    courses: Array<{
      courseCode: string;
      courseName: string;
      totalClasses: string;
      attendedClasses: number;
      conductedClasses: number;
      percentage: number | null;
      bunkAllowance75: number;
      classesNeeded75: number;
      bunkAllowance85: number;
      classesNeeded85: number;
    }>;
  }> {
    const sems = await this.getSemesters();
    let targetSem = sems[0];
    if (semId) {
      const found = sems.find((s) => s.id === semId || s.name.toLowerCase() === semId.toLowerCase());
      if (found) targetSem = found;
    }

    const html = await this.doAjax('studentProfilePESUAdmin', 'POST', {
      controllerMode: 6407,
      actionType: 8,
      batchClassId: targetSem ? targetSem.id : 0,
      menuId: 660,
    });

    const $ = cheerio.load(html);
    const courses: any[] = [];
    $('table tbody tr').each((_, tr) => {
      const tds = $(tr).find('td');
      if (tds.length >= 4) {
        const code = $(tds[0]).text().trim();
        const name = $(tds[1]).text().trim();
        const totalStr = $(tds[2]).text().trim();
        const pctStr = $(tds[3]).text().trim();

        let attended = 0;
        let conducted = 0;
        let pct: number | null = null;

        if (totalStr.includes('/')) {
          const parts = totalStr.split('/');
          attended = parseInt(parts[0], 10) || 0;
          conducted = parseInt(parts[1], 10) || 0;
        }
        if (!isNaN(parseFloat(pctStr))) {
          pct = parseFloat(pctStr);
        }

        // Calculate bunk/attendance metrics
        let bunkAllowance75 = 0;
        let classesNeeded75 = 0;
        let bunkAllowance85 = 0;
        let classesNeeded85 = 0;

        if (conducted > 0) {
          // Bunk allowance: max additional absences x where attended / (conducted + x) >= P
          bunkAllowance75 = Math.max(0, Math.floor((attended - 0.75 * conducted) / 0.75));
          classesNeeded75 = Math.max(0, Math.ceil((0.75 * conducted - attended) / 0.25));

          bunkAllowance85 = Math.max(0, Math.floor((attended - 0.85 * conducted) / 0.85));
          classesNeeded85 = Math.max(0, Math.ceil((0.85 * conducted - attended) / 0.15));
        }

        courses.push({
          courseCode: code,
          courseName: name,
          totalClasses: totalStr,
          attendedClasses: attended,
          conductedClasses: conducted,
          percentage: pct,
          bunkAllowance75,
          classesNeeded75,
          bunkAllowance85,
          classesNeeded85,
        });
      }
    });

    return {
      semester: targetSem ? targetSem.name : 'Current',
      courses,
    };
  }

  // --- 2. Results ---
  public async getResults(semId?: string): Promise<{
    semester: string;
    sgpa: string | null;
    cgpa: string | null;
    earnedCredits: string | null;
    subjects: Array<{
      courseCode: string;
      courseName: string;
      credits: string;
      isaMarks: string;
      esaGrade: string;
    }>;
  }> {
    const sems = await this.getSemesters();
    let targetSemId = sems[1] ? sems[1].id : sems[0]?.id; // default to most recent completed
    if (semId) {
      const found = sems.find((s) => s.id === semId || s.name.toLowerCase() === semId.toLowerCase());
      if (found) targetSemId = found.id;
    }

    const html = await this.doAjax('studentProfilePESUAdmin', 'POST', {
      controllerMode: 6402,
      actionType: 9,
      semid: targetSemId,
      menuId: 652,
    });

    const $ = cheerio.load(html);
    let sgpa: string | null = null;
    let cgpa: string | null = null;
    let earnedCredits: string | null = null;

    const fullText = $.text();
    const sgpaMatch = fullText.match(/SGPA\s*[:\s]*([\d\.]+)/i);
    if (sgpaMatch) sgpa = sgpaMatch[1];
    const cgpaMatch = fullText.match(/CGPA\s*[:\s]*([\d\.]+)/i);
    if (cgpaMatch) cgpa = cgpaMatch[1];
    const credMatch = fullText.match(/Earned Credits\s*[:\s]*([\d\.\/]+)/i);
    if (credMatch) earnedCredits = credMatch[1];

    const subjects: any[] = [];
    $('.panel-body, table tbody tr, .row').each((_, el) => {
      const text = $(el).text();
      const codeMatch = text.match(/([Uu][EeZz]\d{2}[A-Za-z0-9]+)\s*-\s*([^-\n]+)/);
      if (codeMatch) {
        const code = codeMatch[1].trim();
        const name = codeMatch[2].trim();
        const creds = text.match(/Credits\s*:\s*([\d\/\s]+)/i)?.[1]?.trim() || '';
        const isa = text.match(/ISA\s*([A-Za-z0-9\.]+)/i)?.[1]?.trim() || '';
        const esa = text.match(/ESA\s*([A-Za-z0-9\+]+)/i)?.[1]?.trim() || '';
        if (!subjects.some((s) => s.courseCode === code)) {
          subjects.push({
            courseCode: code,
            courseName: name,
            credits: creds,
            isaMarks: isa,
            esaGrade: esa,
          });
        }
      }
    });

    return {
      semester: sems.find((s) => s.id === targetSemId)?.name || targetSemId || 'Current',
      sgpa,
      cgpa,
      earnedCredits,
      subjects,
    };
  }

  // --- 3. Announcements ---
  public async getAnnouncements(limit: number = 20): Promise<
    Array<{
      id: number;
      date: string;
      title: string;
      preview: string;
      attachmentName: string | null;
      attachmentId: string | null;
    }>
  > {
    const html = await this.doAjax('studentProfilePESUAdmin', 'GET', {
      controllerMode: 6411,
      actionType: 5,
      menuId: 667,
    });

    const $ = cheerio.load(html);
    const announcements: any[] = [];

    $('.elem-info-wrapper, .panel-anouncementholder, .panel').each((_, el) => {
      const date = $(el).find('.text-date, span[style*="font-size: small"]').first().text().trim();
      const titleLink = $(el).find('h4 a, a.readmorelink, h4.text-info a').first();
      const title = $(el).find('h4').text().trim() || titleLink.text().trim();
      const onclick = titleLink.attr('onclick') || $(el).find('a[onclick*="handleShowMoreAnnouncement"]').attr('onclick') || '';
      
      const idMatch = onclick.match(/handleShowMoreAnnouncement\(\s*\d+\s*,\s*\d+\s*,\s*(\d+)\s*\)/);
      const id = idMatch ? parseInt(idMatch[1], 10) : 0;

      const pText = $(el).find('p').text().trim();
      const attachmentLink = $(el).find('a[href*="handleDownloadAnoncemntdoc"]');
      let attachmentName: string | null = null;
      let attachmentId: string | null = null;

      if (attachmentLink.length > 0) {
        attachmentName = attachmentLink.text().trim();
        const docMatch = attachmentLink.attr('href')?.match(/handleDownloadAnoncemntdoc\('(\d+)'\)/);
        if (docMatch) attachmentId = docMatch[1];
      }

      if (title && id) {
        announcements.push({
          id,
          date,
          title,
          preview: pText,
          attachmentName,
          attachmentId,
        });
      }
    });

    return announcements.slice(0, limit);
  }

  public async getAnnouncementDetails(announcementId: number): Promise<{
    id: number;
    title: string;
    date: string;
    content: string;
    attachmentName: string | null;
    attachmentId: string | null;
  }> {
    const html = await this.doAjax('studentProfilePESUAdmin', 'POST', {
      controllerMode: 6411,
      actionType: 4,
      AnnouncementId: announcementId,
      menuId: 667,
    });

    const $ = cheerio.load(html);
    const title = $('h4.text-info, h3, h4').first().text().trim();
    const date = $('.text-date').first().text().trim();
    const content = $('.elem-info-wrapper, .panel-body').text().replace(/\s+/g, ' ').trim();

    let attachmentName: string | null = null;
    let attachmentId: string | null = null;
    $('a[href*="handleDownloadAnoncemntdoc"]').each((_, a) => {
      attachmentName = $(a).text().trim();
      const match = $(a).attr('href')?.match(/handleDownloadAnoncemntdoc\('(\d+)'\)/);
      if (match) attachmentId = match[1];
    });

    return {
      id: announcementId,
      title,
      date,
      content,
      attachmentName,
      attachmentId,
    };
  }

  public async downloadAnnouncementAttachment(
    attachmentId: string,
    outputDir: string = './downloads'
  ): Promise<{ filename: string; path: string; size: number }> {
    if (!attachmentId) throw new Error('Attachment ID is required.');
    await this.ensureAuthenticated();
    const targetDir = resolveOutputDir(outputDir);
    fs.mkdirSync(targetDir, { recursive: true });

    const url = `/Academy/s/studentProfilePESUAdmin/downloadAnoncemntdoc/${attachmentId}`;
    const res = await this.client.get(url, {
      responseType: 'arraybuffer',
      headers: {
        'X-CSRF-Token': this.csrfToken,
        Referer: `${this.baseUrl}/Academy/s/studentProfilePESU`,
      },
    });

    let filename = `announcement_${attachmentId}.pdf`;
    const disposition = res.headers['content-disposition'];
    if (disposition && disposition.includes('filename=')) {
      const match = disposition.match(/filename="?([^"]+)"?/);
      if (match) filename = match[1];
    }

    const cleanFilename = sanitizeFilename(filename);
    const filePath = path.join(targetDir, cleanFilename);
    fs.writeFileSync(filePath, Buffer.from(res.data));
    return {
      filename: cleanFilename,
      path: filePath,
      size: res.data.byteLength,
    };
  }

  public async readAnnouncementAttachmentText(attachmentId: string): Promise<string> {
    if (!attachmentId) throw new Error('Attachment ID is required.');
    await this.ensureAuthenticated();
    const url = `/Academy/s/studentProfilePESUAdmin/downloadAnoncemntdoc/${attachmentId}`;
    const res = await this.client.get(url, {
      responseType: 'arraybuffer',
      headers: {
        'X-CSRF-Token': this.csrfToken,
        Referer: `${this.baseUrl}/Academy/s/studentProfilePESU`,
      },
    });

    const pdfModule = (await import('pdf-parse')) as any;
    if (pdfModule.PDFParse) {
      const parser = new pdfModule.PDFParse(new Uint8Array(res.data));
      const result = await parser.getText();
      return typeof result === 'string' ? result : (result.text || '');
    } else {
      const pdfFn = pdfModule.default || pdfModule;
      const parsed = await pdfFn(Buffer.from(res.data));
      return parsed.text || '';
    }
  }

  // --- 4. Time Table ---
  public async getTimetable(): Promise<any> {
    const html = await this.doAjax('studentProfilePESUAdmin', 'GET', {
      controllerMode: 6415,
      actionType: 5,
      menuId: 669,
    });

    const $ = cheerio.load(html);
    const script = $('script').text();
    const batchMatch = html.match(/Class Name:\s*([^\s<]+)/);
    const sectionMatch = html.match(/Section:\s*([^\s<]+)/);

    // Parse timeTableTemplateDetailsJson and timeTableJson from inline script if present
    const ttJsonMatch = script.match(/var\s+timeTableJson\s*=\s*(\[[^\]]*\]|{[^}]*});/);
    const templateMatch = script.match(/var\s+timeTableTemplateDetailsJson\s*=\s*(\[[^\]]*\]|{[^}]*});/);

    const safeParse = (str: string | null) => {
      if (!str) return null;
      try {
        return JSON.parse(str);
      } catch {
        return null;
      }
    };

    return {
      className: batchMatch ? batchMatch[1] : 'Unknown',
      section: sectionMatch ? sectionMatch[1] : 'Unknown',
      tableRaw: script.includes('handleTimeTable') ? 'Available in template' : 'Empty schedule',
      timetableJson: safeParse(ttJsonMatch ? ttJsonMatch[1] : null),
      templateJson: safeParse(templateMatch ? templateMatch[1] : null),
    };
  }

  // --- 5. My Courses, Units & Slides/Notes (Deep Exploration) ---
  public async getCourses(semId?: string): Promise<
    Array<{
      code: string;
      title: string;
      type: string;
      status: string;
      courseContentId: string | null;
    }>
  > {
    const sems = await this.getSemesters();
    let targetSemId = sems[0]?.id;
    if (semId) {
      const found = sems.find((s) => s.id === semId || s.name.toLowerCase() === semId.toLowerCase());
      if (found) targetSemId = found.id;
    }

    const html = await this.doAjax('studentProfilePESUAdmin', 'POST', {
      controllerMode: 6403,
      actionType: 38,
      id: targetSemId,
      menuId: 653,
    });

    const $ = cheerio.load(html);
    const courses: any[] = [];

    $('table:first-of-type tbody tr').each((_, tr) => {
      const tds = $(tr).find('td');
      if (tds.length >= 4) {
        const code = $(tds[0]).text().trim();
        const title = $(tds[1]).text().trim();
        const type = $(tds[2]).text().trim();
        const status = $(tds[3]).text().trim();

        const onclick = $(tr).attr('onclick') || '';
        const idMatch = onclick.match(/clickOnCourseContent\('(\d+)'/);
        const courseContentId = idMatch ? idMatch[1] : null;

        courses.push({
          code,
          title,
          type,
          status,
          courseContentId,
        });
      }
    });

    return courses;
  }

  public async getCourseUnits(courseContentId: string): Promise<{
    courseName: string;
    units: Array<{
      unitName: string;
      unitContentId: string;
    }>;
  }> {
    if (!courseContentId) throw new Error('Course content ID is required.');
    const html = await this.doAjax('studentProfilePESUAdmin', 'GET', {
      controllerMode: 6403,
      actionType: 42,
      id: courseContentId,
      menuId: 653,
    });

    const $ = cheerio.load(html);
    const courseName = $('h4, h3').first().text().trim();
    const units: Array<{ unitName: string; unitContentId: string }> = [];

    $('a[onclick*="handleclassUnit"]').each((_, a) => {
      const name = $(a).text().trim();
      const match = $(a).attr('onclick')?.match(/handleclassUnit\('(\d+)'\)/);
      if (match && name) {
        units.push({
          unitName: name,
          unitContentId: match[1],
        });
      }
    });

    return { courseName, units };
  }

  public async getUnitTopics(unitContentId: string): Promise<
    Array<{
      topicName: string;
      classNo: string;
      slidesCount: number;
      notesCount: number;
      assignmentsCount: number;
      qbCount: number;
      courseUnitId: string;
      subjectId: string;
      courseContentId: string;
    }>
  > {
    if (!unitContentId) throw new Error('Unit content ID is required.');
    const html = await this.doAjax('studentProfilePESUAdmin', 'GET', {
      controllerMode: 6403,
      actionType: 43,
      coursecontentid: unitContentId,
      menuId: 653,
      selectedData: 0,
      subType: 0,
    });

    const $ = cheerio.load(html);
    const topics: any[] = [];

    // Each row has class details and links with handleclasscoursecontentunit
    $('tr').each((_, tr) => {
      const links = $(tr).find('a[onclick*="handleclasscoursecontentunit"]');
      if (links.length > 0) {
        const topicName = $(tr).find('td:first-child').text().replace(/\s+/g, ' ').trim();
        // Extract args from the first link
        const onclick = $(links[0]).attr('onclick') || '';
        const match = onclick.match(
          /handleclasscoursecontentunit\('([^']+)',\s*'([^']+)',\s*'([^']+)',\s*'([^']+)'/
        );

        if (match) {
          const courseUnitId = match[1];
          const subjectId = match[2];
          const courseContentId = match[3];
          const classNo = match[4];

          // Parse numbers for slides, notes
          let slidesCount = 0;
          let notesCount = 0;
          let assignmentsCount = 0;
          let qbCount = 0;

          links.each((_, l) => {
            const lOnclick = $(l).attr('onclick') || '';
            const typeMatch = lOnclick.match(/handleclasscoursecontentunit\([^)]*,\s*(\d+)\s*,\s*event\)/);
            const count = parseInt($(l).text().trim(), 10) || 0;
            if (typeMatch) {
              const type = parseInt(typeMatch[1], 10);
              if (type === 10 || type === 2) slidesCount = count;
              if (type === 1 || type === 3) notesCount = count;
              if (type === 5) assignmentsCount = count;
              if (type === 6) qbCount = count;
            }
          });

          topics.push({
            topicName,
            classNo,
            slidesCount,
            notesCount,
            assignmentsCount,
            qbCount,
            courseUnitId,
            subjectId,
            courseContentId,
          });
        }
      }
    });

    return topics;
  }

  public async getTopicDocuments(
    courseUnitId: string,
    subjectId: string,
    courseContentId: string,
    classNo: string,
    type: 'slides' | 'notes' = 'slides'
  ): Promise<
    Array<{
      title: string;
      docId: string;
      downloadUrl: string;
    }>
  > {
    const typeId = type === 'slides' ? 2 : 3;
    const html = await this.doAjax('studentProfilePESUAdmin', 'GET', {
      controllerMode: 6403,
      actionType: 60,
      selectedData: subjectId,
      id: typeId,
      unitid: courseUnitId,
      coursecontentid: courseContentId,
      classno: classNo,
      menuId: 653,
      subType: 0,
    });

    const $ = cheerio.load(html);
    const docs: any[] = [];

    $('a[onclick*="loadIframe"]').each((_, a) => {
      const title = $(a).text().trim();
      const onclick = $(a).attr('onclick') || '';
      const match = onclick.match(/loadIframe\('([^']+)',\s*'([^']+)'\)/);
      if (match) {
        const docId = match[2];
        docs.push({
          title,
          docId,
          downloadUrl: `/Academy/a/referenceMeterials/downloadslidecoursedoc/${docId}`,
        });
      }
    });

    return docs;
  }

  public async downloadCourseMaterial(
    docId: string,
    customFilename?: string,
    outputDir: string = './downloads'
  ): Promise<{ filename: string; path: string; size: number }> {
    if (!docId) throw new Error('Document ID is required.');
    await this.ensureAuthenticated();
    const targetDir = resolveOutputDir(outputDir);
    fs.mkdirSync(targetDir, { recursive: true });

    const url = `/Academy/a/referenceMeterials/downloadslidecoursedoc/${docId}`;
    const res = await this.client.get(url, {
      responseType: 'arraybuffer',
      headers: {
        'X-CSRF-Token': this.csrfToken,
        Referer: `${this.baseUrl}/Academy/s/studentProfilePESU`,
      },
    });

    let filename = customFilename || `material_${docId}.pdf`;
    const disposition = res.headers['content-disposition'];
    if (!customFilename && disposition && disposition.includes('filename=')) {
      const match = disposition.match(/filename="?([^"]+)"?/);
      if (match) filename = match[1];
    }
    if (!filename.endsWith('.pdf')) filename += '.pdf';

    const cleanFilename = sanitizeFilename(filename);
    const filePath = path.join(targetDir, cleanFilename);
    fs.writeFileSync(filePath, Buffer.from(res.data));
    return {
      filename: cleanFilename,
      path: filePath,
      size: res.data.byteLength,
    };
  }

  // Smart Retriever: Given a natural query like "database unit 2 slides" or "machine learning unit 1 notes"
  public async searchAndDownloadCourseMaterial(
    courseQuery: string,
    unitQuery: string,
    materialType: 'slides' | 'notes' = 'slides',
    outputDir: string = './downloads'
  ): Promise<{
    downloadedFiles: Array<{ title: string; path: string; size: number }>;
    message: string;
  }> {
    if (!courseQuery) throw new Error('Course query is required.');
    if (!unitQuery) throw new Error('Unit query is required.');
    const sems = await this.getSemesters();
    let courses: any[] = [];

    // Search courses across recent semesters
    for (const sem of sems.slice(0, 3)) {
      const cList = await this.getCourses(sem.id);
      courses.push(...cList);
    }

    const matchedCourse = courses.find(
      (c) =>
        c.courseContentId &&
        (c.title.toLowerCase().includes(courseQuery.toLowerCase()) ||
          c.code.toLowerCase().includes(courseQuery.toLowerCase()))
    );

    if (!matchedCourse || !matchedCourse.courseContentId) {
      return {
        downloadedFiles: [],
        message: `No registered course found matching "${courseQuery}".`,
      };
    }

    const unitsRes = await this.getCourseUnits(matchedCourse.courseContentId);
    const matchedUnit = unitsRes.units.find(
      (u) =>
        u.unitName.toLowerCase().includes(unitQuery.toLowerCase()) ||
        u.unitName.toLowerCase().includes(`unit ${unitQuery}`)
    );

    if (!matchedUnit) {
      return {
        downloadedFiles: [],
        message: `Found course "${matchedCourse.title}", but no unit found matching "${unitQuery}". Available units: ${unitsRes.units.map((u) => u.unitName).join(', ')}`,
      };
    }

    const topics = await this.getUnitTopics(matchedUnit.unitContentId);
    const downloadedFiles: any[] = [];

    for (const topic of topics) {
      const docs = await this.getTopicDocuments(
        topic.courseUnitId,
        topic.subjectId,
        topic.courseContentId,
        topic.classNo,
        materialType
      );

      for (const doc of docs) {
        const cleanTitle = doc.title.replace(/[^\w\d-_]/g, '_');
        const dl = await this.downloadCourseMaterial(
          doc.docId,
          `${matchedCourse.code}_${matchedUnit.unitName}_${cleanTitle}.pdf`,
          outputDir
        );
        downloadedFiles.push({
          title: doc.title,
          path: dl.path,
          size: dl.size,
        });
      }
    }

    return {
      downloadedFiles,
      message: `Downloaded ${downloadedFiles.length} ${materialType} for ${matchedCourse.title} - ${matchedUnit.unitName}.`,
    };
  }

  // --- 6. Assignments ---
  public async getAssignments(semId?: string): Promise<
    Array<{
      assignmentName: string;
      type: string;
      subject: string;
      startDate: string;
      endDate: string;
      status: string;
      evaluationStatus: string;
      marksObtained: string;
      maxMarks: string;
    }>
  > {
    const html = await this.doAjax('studentProfileAdmin', 'GET', {
      controllerMode: 6591,
      actionType: 5,
      menuId: 659,
    });

    const $ = cheerio.load(html);
    const assignments: any[] = [];

    $('table tbody tr').each((_, tr) => {
      const tds = $(tr).find('td');
      if (tds.length >= 9) {
        assignments.push({
          assignmentName: $(tds[0]).text().trim(),
          type: $(tds[1]).text().trim(),
          subject: $(tds[2]).text().trim(),
          startDate: $(tds[3]).text().trim(),
          endDate: $(tds[4]).text().trim(),
          status: $(tds[5]).text().trim(),
          evaluationStatus: $(tds[6]).text().trim(),
          marksObtained: $(tds[7]).text().trim(),
          maxMarks: $(tds[8]).text().trim(),
        });
      }
    });

    return assignments;
  }

  // --- 7. Seating Info ---
  public async getSeatingInfo(): Promise<string> {
    const html = await this.doAjax('studentProfilePESUAdmin', 'GET', {
      controllerMode: 6404,
      actionType: 5,
      menuId: 655,
    });
    const $ = cheerio.load(html);
    return $.text().replace(/\s+/g, ' ').trim();
  }

  // --- 8. My Profile ---
  public async getProfile(): Promise<Record<string, string>> {
    const html = await this.doAjax('studentProfilePESUAdmin', 'GET', {
      controllerMode: 6414,
      actionType: 5,
      menuId: 670,
    });

    const $ = cheerio.load(html);
    const profile: Record<string, string> = {};

    $('.col-md-6, .col-md-4, .col-md-3, .form-group').each((_, el) => {
      const label = $(el).find('span.lbl-title-light, label, b, strong').first().text().replace(':', '').trim();
      const val = $(el).find('.form-control-static, span:not(.lbl-title-light), p').text().trim();
      if (label && val) {
        profile[label] = val;
      }
    });

    // Fallback extraction
    const rawText = $.text();
    const fields = [
      'Name',
      'PESU Id',
      'SRN',
      'Program',
      'Branch',
      'Semester',
      'Section',
      'Email ID',
      'Contact No',
      'SSLC Marks',
      'PUC Marks',
    ];
    for (const f of fields) {
      if (!profile[f]) {
        const match = rawText.match(new RegExp(`${f}\\s*[:\\s]*([^\\n\\r]+)`));
        if (match) profile[f] = match[1].trim();
      }
    }

    return profile;
  }

  // --- 9. Academic Calendar ---
  public async getCalendar(): Promise<Array<{ date: string; day: string; event: string }>> {
    const html = await this.doAjax('studentProfilePESUAdmin', 'GET', {
      controllerMode: 6413,
      actionType: 5,
      menuId: 668,
    });

    const $ = cheerio.load(html);
    const events: any[] = [];

    // Parse calendar event rows
    const text = $.text().replace(/\s+/g, ' ');
    const eventRegex =
      /([A-Za-z]+\s+\d{1,2},\s+\d{4})\s+([A-Za-z]+)\s+all-day\s+([^\n]+?)(?=(?:[A-Za-z]+\s+\d{1,2},\s+\d{4})|$)/g;
    let match;
    while ((match = eventRegex.exec(text)) !== null) {
      events.push({
        date: match[1],
        day: match[2],
        event: match[3].trim(),
      });
    }

    return events;
  }

  // --- 10. Quizzes ---
  public async getQuizzes(): Promise<{
    currentSchedules: any[];
    previousSchedules: any[];
  }> {
    const html = await this.doAjax('studentProfilePESUAdmin', 'GET', {
      controllerMode: 6422,
      actionType: 5,
      menuId: 75401,
    });

    const $ = cheerio.load(html);
    const current: any[] = [];
    const previous: any[] = [];

    $('table#currentTestId tbody tr').each((_, tr) => {
      const tds = $(tr).find('td');
      if (tds.length >= 7) {
        current.push({
          subjectCode: $(tds[0]).text().trim(),
          subjectName: $(tds[1]).text().trim(),
          startTime: $(tds[2]).text().trim(),
          endTime: $(tds[3]).text().trim(),
          duration: $(tds[4]).text().trim(),
          totalQuestions: $(tds[5]).text().trim(),
          totalMarks: $(tds[6]).text().trim(),
        });
      }
    });

    $('table#oldTestId tbody tr').each((_, tr) => {
      const tds = $(tr).find('td');
      if (tds.length >= 7) {
        previous.push({
          subjectCode: $(tds[0]).text().trim(),
          subjectName: $(tds[1]).text().trim(),
          startTime: $(tds[2]).text().trim(),
          endTime: $(tds[3]).text().trim(),
          duration: $(tds[4]).text().trim(),
          totalQuestions: $(tds[5]).text().trim(),
          totalMarks: $(tds[6]).text().trim(),
        });
      }
    });

    return { currentSchedules: current, previousSchedules: previous };
  }

  // --- 11. Hall Ticket Check & Download ---
  public async checkHallTicket(): Promise<{
    isReleased: boolean;
    activeEsaList: Array<{ esaId: string; name: string }>;
    message: string;
  }> {
    const html = await this.doAjax(
      '/Academy/s/studentProfile/getActioveBasedEsaId/244',
      'GET'
    );
    const $ = cheerio.load(html);
    const options: Array<{ esaId: string; name: string }> = [];

    $('option').each((_, el) => {
      const val = $(el).val();
      const txt = $(el).text().trim();
      if (val && val !== '0') {
        options.push({ esaId: String(val), name: txt });
      }
    });

    const isReleased = options.length > 0;
    return {
      isReleased,
      activeEsaList: options,
      message: isReleased
        ? `Hall ticket is RELEASED for: ${options.map((o) => o.name).join(', ')}.`
        : 'Hall ticket has not been released yet for the upcoming examinations.',
    };
  }

  public async downloadHallTicket(
    esaId?: string,
    outputDir: string = './downloads'
  ): Promise<{ filename: string; path: string; size: number }> {
    const status = await this.checkHallTicket();
    if (!status.isReleased) {
      throw new Error('Hall ticket is not currently released.');
    }

    const targetEsaId = esaId || status.activeEsaList[0]?.esaId;
    if (!targetEsaId) {
      throw new Error('No active ESA ID found.');
    }

    const targetDir = resolveOutputDir(outputDir);
    fs.mkdirSync(targetDir, { recursive: true });
    const url = `/Academy/s/reports/Reports/downloadStudentHallTicket/${targetEsaId}/658`;
    const res = await this.client.get(url, {
      responseType: 'arraybuffer',
      headers: {
        'X-CSRF-Token': this.csrfToken,
        Referer: `${this.baseUrl}/Academy/s/studentProfilePESU`,
      },
    });

    const filename = `HallTicket_${targetEsaId}.pdf`;
    const cleanFilename = sanitizeFilename(filename);
    const filePath = path.join(targetDir, cleanFilename);
    fs.writeFileSync(filePath, Buffer.from(res.data));

    return {
      filename: cleanFilename,
      path: filePath,
      size: res.data.byteLength,
    };
  }

  // --- 17. Grievance Redressal ---
  public async getGrievances(): Promise<
    Array<{
      ticketNumber: string;
      createdDate: string;
      problemType: string;
      closedDate: string;
      status: string;
    }>
  > {
    const html = await this.doAjax('studentProfilePESUAdmin', 'GET', {
      controllerMode: 6421,
      actionType: 5,
      menuId: 680,
    });

    const $ = cheerio.load(html);
    const tickets: any[] = [];

    $('table tbody tr').each((_, tr) => {
      const tds = $(tr).find('td');
      if (tds.length >= 6) {
        const tkt = $(tds[1]).text().trim();
        if (tkt && !tkt.includes('No data available')) {
          tickets.push({
            ticketNumber: tkt,
            createdDate: $(tds[2]).text().trim(),
            problemType: $(tds[3]).text().trim(),
            closedDate: $(tds[4]).text().trim(),
            status: $(tds[5]).text().trim(),
          });
        }
      }
    });

    return tickets;
  }

  // --- 21. Backlog Registration Status ---
  public async checkBacklogStatus(): Promise<{
    isAvailable: boolean;
    message: string;
  }> {
    const html = await this.doAjax('studentProfilePESUAdmin', 'GET', {
      controllerMode: 6419,
      actionType: 5,
      menuId: 672,
    });

    const isAvailable = !html.includes('Backlog Registration is currently not available');
    return {
      isAvailable,
      message: isAvailable
        ? 'Backlog ESA Registration is currently OPEN.'
        : 'Backlog Registration is currently NOT available.',
    };
  }
}
