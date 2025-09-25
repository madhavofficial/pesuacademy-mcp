import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { PesuClient } from '../src/pesu-client.js';
import { MockPesuServer } from './mock-server.js';

describe('PesuClient Operations and Edge Cases', () => {
  let mockServer: MockPesuServer;
  const tempDownloadDir = path.join(process.cwd(), 'scratch/test_downloads');

  before(async () => {
    mockServer = new MockPesuServer();
    await mockServer.start();
    fs.mkdirSync(tempDownloadDir, { recursive: true });
  });

  after(async () => {
    await mockServer.stop();
    if (fs.existsSync(tempDownloadDir)) {
      fs.rmSync(tempDownloadDir, { recursive: true, force: true });
    }
  });

  beforeEach(() => {
    // Reset any mock scenario toggles
    mockServer.sessionExpiredOnce = false;
    mockServer.emptySemesters = false;
    mockServer.emptyAttendance = false;
    mockServer.zeroAttendance = false;
    mockServer.malformedAttendance = false;
    mockServer.emptyResults = false;
    mockServer.missingGpaResults = false;
    mockServer.duplicateSubjectResults = false;
    mockServer.emptyAnnouncements = false;
    mockServer.malformedTimetableScript = false;
    mockServer.emptyCourses = false;
    mockServer.emptyCourseUnits = false;
    mockServer.emptyUnitTopics = false;
    mockServer.emptyTopicDocs = false;
    mockServer.hallTicketReleased = true;
    mockServer.backlogAvailable = true;
    mockServer.returnInvalidPdf = false;
  });

  describe('Authentication & Session Handling', () => {
    test('authenticates successfully via valid sessionId', async () => {
      const client = new PesuClient({
        sessionId: 'valid_mock_session_12345',
        baseUrl: mockServer.baseUrl,
      });
      const ok = await client.authenticate();
      assert.strictEqual(ok, true);
    });

    test('falls back to username/password if sessionId is invalid or expired', async () => {
      const client = new PesuClient({
        sessionId: 'expired_invalid_session',
        username: 'PES1202200000',
        password: 'Password123',
        baseUrl: mockServer.baseUrl,
      });
      const ok = await client.authenticate();
      assert.strictEqual(ok, true);
    });

    test('throws Error when no credentials or sessionId provided', async () => {
      const origUser = process.env.PESU_USERNAME;
      const origPass = process.env.PESU_PASSWORD;
      const origSess = process.env.PESU_SESSION_ID;
      delete process.env.PESU_USERNAME;
      delete process.env.PESU_PASSWORD;
      delete process.env.PESU_SESSION_ID;

      const client = new PesuClient({ baseUrl: mockServer.baseUrl });
      await assert.rejects(
        async () => await client.authenticate(),
        /Missing PESU credentials/
      );

      if (origUser) process.env.PESU_USERNAME = origUser;
      if (origPass) process.env.PESU_PASSWORD = origPass;
      if (origSess) process.env.PESU_SESSION_ID = origSess;
    });

    test('returns false when credentials are invalid and login form returns', async () => {
      const client = new PesuClient({
        username: 'WRONG_USER',
        password: 'WRONG_PASSWORD',
        baseUrl: mockServer.baseUrl,
      });
      const ok = await client.authenticate();
      assert.strictEqual(ok, false);
    });

    test('doAjax re-authenticates and retries automatically on 401 session expiry', async () => {
      const client = new PesuClient({
        username: 'PES1202200000',
        password: 'Password123',
        baseUrl: mockServer.baseUrl,
      });
      await client.authenticate();

      // Trigger 401 on next call
      mockServer.sessionExpiredOnce = true;
      const semesters = await client.getSemesters();
      assert.ok(Array.isArray(semesters));
      assert.strictEqual(semesters.length, 3);
    });
  });

  describe('Semesters & Attendance Operations', () => {
    test('getSemesters extracts all semesters', async () => {
      const client = new PesuClient({
        sessionId: 'valid_mock_session_12345',
        baseUrl: mockServer.baseUrl,
      });
      const sems = await client.getSemesters();
      assert.strictEqual(sems.length, 3);
      assert.strictEqual(sems[0].name, 'Sem-6');
      assert.strictEqual(sems[0].id, '3199');
    });

    test('getSemesters returns empty array when select has no options', async () => {
      mockServer.emptySemesters = true;
      const client = new PesuClient({
        sessionId: 'valid_mock_session_12345',
        baseUrl: mockServer.baseUrl,
      });
      const sems = await client.getSemesters();
      assert.deepStrictEqual(sems, []);
    });

    test('getAttendance calculates attendance and bunk allowances accurately', async () => {
      const client = new PesuClient({
        sessionId: 'valid_mock_session_12345',
        baseUrl: mockServer.baseUrl,
      });
      const res = await client.getAttendance();
      assert.strictEqual(res.semester, 'Sem-6');
      assert.strictEqual(res.courses.length, 2);

      // Course 1: 35/40 (87.5%)
      const c1 = res.courses[0];
      assert.strictEqual(c1.courseCode, 'UE23CS351A');
      assert.strictEqual(c1.attendedClasses, 35);
      assert.strictEqual(c1.conductedClasses, 40);
      assert.strictEqual(c1.percentage, 87.5);
      assert.strictEqual(c1.bunkAllowance75, 6);
      assert.strictEqual(c1.classesNeeded75, 0);
      assert.strictEqual(c1.bunkAllowance85, 1);
      assert.strictEqual(c1.classesNeeded85, 0);

      // Course 2: 20/40 (50.0%)
      const c2 = res.courses[1];
      assert.strictEqual(c2.courseCode, 'UE23CS352A');
      assert.strictEqual(c2.percentage, 50.0);
      assert.strictEqual(c2.bunkAllowance75, 0);
      assert.strictEqual(c2.classesNeeded75, 40); // (0.75*40 - 20) / 0.25 = 10 / 0.25 = 40
      assert.strictEqual(c2.bunkAllowance85, 0);
      assert.strictEqual(c2.classesNeeded85, 94); // ceil((0.85*40 - 20) / 0.15) = ceil(14/0.15) = 94
    });

    test('getAttendance edge case: 0 conducted classes (0/0) avoids division by zero', async () => {
      mockServer.zeroAttendance = true;
      const client = new PesuClient({
        sessionId: 'valid_mock_session_12345',
        baseUrl: mockServer.baseUrl,
      });
      const res = await client.getAttendance();
      assert.strictEqual(res.courses.length, 1);
      const c = res.courses[0];
      assert.strictEqual(c.conductedClasses, 0);
      assert.strictEqual(c.attendedClasses, 0);
      assert.strictEqual(c.bunkAllowance75, 0);
      assert.strictEqual(c.classesNeeded75, 0);
      assert.strictEqual(c.bunkAllowance85, 0);
      assert.strictEqual(c.classesNeeded85, 0);
    });

    test('getAttendance edge case: malformed or missing total/pct cells', async () => {
      mockServer.malformedAttendance = true;
      const client = new PesuClient({
        sessionId: 'valid_mock_session_12345',
        baseUrl: mockServer.baseUrl,
      });
      const res = await client.getAttendance();
      assert.strictEqual(res.courses.length, 1);
      assert.strictEqual(res.courses[0].attendedClasses, 0);
      assert.strictEqual(res.courses[0].conductedClasses, 0);
      assert.strictEqual(res.courses[0].percentage, null);
    });

    test('getAttendance handles semester name match and unknown semester fallback', async () => {
      const client = new PesuClient({
        sessionId: 'valid_mock_session_12345',
        baseUrl: mockServer.baseUrl,
      });
      // Explicit semester match by name
      const res1 = await client.getAttendance('Sem-5');
      assert.strictEqual(res1.semester, 'Sem-5');

      // Unknown semester fallback
      const res2 = await client.getAttendance('NonExistentSem');
      assert.strictEqual(res2.semester, 'Sem-6');
    });
  });

  describe('Results Operations', () => {
    test('getResults extracts SGPA, CGPA, Earned Credits and subjects', async () => {
      const client = new PesuClient({
        sessionId: 'valid_mock_session_12345',
        baseUrl: mockServer.baseUrl,
      });
      const res = await client.getResults();
      assert.strictEqual(res.sgpa, '9.15');
      assert.strictEqual(res.cgpa, '8.85');
      assert.strictEqual(res.earnedCredits, '22/22');
      assert.strictEqual(res.subjects.length, 2);
      assert.strictEqual(res.subjects[0].courseCode, 'UE23CS351A');
      assert.strictEqual(res.subjects[0].esaGrade, 'S');
      assert.strictEqual(res.subjects[1].courseCode, 'UE23CS352A');
      assert.strictEqual(res.subjects[1].esaGrade, 'A');
    });

    test('getResults edge case: missing SGPA/CGPA returns nulls', async () => {
      mockServer.missingGpaResults = true;
      const client = new PesuClient({
        sessionId: 'valid_mock_session_12345',
        baseUrl: mockServer.baseUrl,
      });
      const res = await client.getResults();
      assert.strictEqual(res.sgpa, null);
      assert.strictEqual(res.cgpa, null);
      assert.strictEqual(res.earnedCredits, null);
      assert.strictEqual(res.subjects.length, 1);
    });

    test('getResults edge case: deduplicates duplicate subject rows', async () => {
      mockServer.duplicateSubjectResults = true;
      const client = new PesuClient({
        sessionId: 'valid_mock_session_12345',
        baseUrl: mockServer.baseUrl,
      });
      const res = await client.getResults();
      assert.strictEqual(res.subjects.length, 1);
    });

    test('getResults edge case: empty results table', async () => {
      mockServer.emptyResults = true;
      const client = new PesuClient({
        sessionId: 'valid_mock_session_12345',
        baseUrl: mockServer.baseUrl,
      });
      const res = await client.getResults();
      assert.strictEqual(res.subjects.length, 0);
    });
  });

  describe('Announcements & Document Retrieval', () => {
    test('getAnnouncements returns list with limit respected', async () => {
      const client = new PesuClient({
        sessionId: 'valid_mock_session_12345',
        baseUrl: mockServer.baseUrl,
      });
      const all = await client.getAnnouncements(10);
      assert.strictEqual(all.length, 2);
      assert.strictEqual(all[0].id, 7466);
      assert.strictEqual(all[0].attachmentId, '6040');
      assert.strictEqual(all[0].attachmentName, 'Circular_Timetable.pdf');

      // Test limit of 1
      const limited = await client.getAnnouncements(1);
      assert.strictEqual(limited.length, 1);
      assert.strictEqual(limited[0].id, 7466);
    });

    test('getAnnouncementDetails fetches full announcement content', async () => {
      const client = new PesuClient({
        sessionId: 'valid_mock_session_12345',
        baseUrl: mockServer.baseUrl,
      });
      const details = await client.getAnnouncementDetails(7466);
      assert.strictEqual(details.id, 7466);
      assert.strictEqual(details.attachmentId, '6040');
      assert.ok(details.content.includes('Full body text'));
    });

    test('downloadAnnouncementAttachment downloads and saves file to custom dir', async () => {
      const client = new PesuClient({
        sessionId: 'valid_mock_session_12345',
        baseUrl: mockServer.baseUrl,
      });
      const res = await client.downloadAnnouncementAttachment('6040', tempDownloadDir);
      assert.strictEqual(res.filename, 'Circular_6040.pdf');
      assert.ok(fs.existsSync(res.path));
      assert.ok(res.size > 0);
    });

    test('downloadAnnouncementAttachment throws error if attachmentId is missing', async () => {
      const client = new PesuClient({
        sessionId: 'valid_mock_session_12345',
        baseUrl: mockServer.baseUrl,
      });
      await assert.rejects(
        async () => await (client as any).downloadAnnouncementAttachment(''),
        /Attachment ID is required/
      );
    });

    test('readAnnouncementAttachmentText parses PDF and extracts text', async () => {
      const client = new PesuClient({
        sessionId: 'valid_mock_session_12345',
        baseUrl: mockServer.baseUrl,
      });
      const text = await client.readAnnouncementAttachmentText('6040');
      assert.ok(text.includes('PESU Circular Test Content'));
    });

    test('readAnnouncementAttachmentText throws error on corrupted PDF', async () => {
      mockServer.returnInvalidPdf = true;
      const client = new PesuClient({
        sessionId: 'valid_mock_session_12345',
        baseUrl: mockServer.baseUrl,
      });
      await assert.rejects(
        async () => await client.readAnnouncementAttachmentText('6040')
      );
    });
  });

  describe('Timetable Operations', () => {
    test('getTimetable parses batch, section, and JSON templates from script', async () => {
      const client = new PesuClient({
        sessionId: 'valid_mock_session_12345',
        baseUrl: mockServer.baseUrl,
      });
      const tt = await client.getTimetable();
      assert.strictEqual(tt.className, 'CSE-6A');
      assert.strictEqual(tt.section, 'A');
      assert.ok(Array.isArray(tt.timetableJson));
      assert.strictEqual(tt.timetableJson[0].subject, 'DBMS');
      assert.strictEqual(tt.templateJson.template, 'Regular');
    });

    test('getTimetable edge case: handles malformed script JSON without throwing', async () => {
      mockServer.malformedTimetableScript = true;
      const client = new PesuClient({
        sessionId: 'valid_mock_session_12345',
        baseUrl: mockServer.baseUrl,
      });
      const tt = await client.getTimetable();
      assert.strictEqual(tt.className, 'CSE-6A');
      assert.strictEqual(tt.timetableJson, null);
    });
  });

  describe('Course Materials & Smart Search Operations', () => {
    test('getCourses extracts courses and handles rows without onclick', async () => {
      const client = new PesuClient({
        sessionId: 'valid_mock_session_12345',
        baseUrl: mockServer.baseUrl,
      });
      const courses = await client.getCourses();
      assert.strictEqual(courses.length, 3);
      assert.strictEqual(courses[0].code, 'UE23CS351A');
      assert.strictEqual(courses[0].courseContentId, '20970');
      assert.strictEqual(courses[2].courseContentId, null);
    });

    test('getCourseUnits lists units and extracts unitContentId', async () => {
      const client = new PesuClient({
        sessionId: 'valid_mock_session_12345',
        baseUrl: mockServer.baseUrl,
      });
      const res = await client.getCourseUnits('20970');
      assert.strictEqual(res.units.length, 2);
      assert.strictEqual(res.units[0].unitContentId, '62019');
      assert.ok(res.units[0].unitName.includes('Unit 1'));
    });

    test('getCourseUnits throws error when courseContentId is missing', async () => {
      const client = new PesuClient({
        sessionId: 'valid_mock_session_12345',
        baseUrl: mockServer.baseUrl,
      });
      await assert.rejects(
        async () => await (client as any).getCourseUnits(''),
        /Course content ID is required/
      );
    });

    test('getUnitTopics parses topic counts for slides, notes, assignments, qb', async () => {
      const client = new PesuClient({
        sessionId: 'valid_mock_session_12345',
        baseUrl: mockServer.baseUrl,
      });
      const topics = await client.getUnitTopics('62019');
      assert.strictEqual(topics.length, 1);
      const t = topics[0];
      assert.strictEqual(t.slidesCount, 2);
      assert.strictEqual(t.notesCount, 1);
      assert.strictEqual(t.assignmentsCount, 1);
      assert.strictEqual(t.qbCount, 3);
      assert.strictEqual(t.courseUnitId, 'U101');
    });

    test('getTopicDocuments retrieves slides and notes docs', async () => {
      const client = new PesuClient({
        sessionId: 'valid_mock_session_12345',
        baseUrl: mockServer.baseUrl,
      });
      const docs = await client.getTopicDocuments('U101', 'SUB201', 'CC301', '1', 'slides');
      assert.strictEqual(docs.length, 2);
      assert.strictEqual(docs[0].docId, 'doc_uuid_1111');
      assert.strictEqual(docs[1].docId, 'doc_uuid_2222');
    });

    test('downloadCourseMaterial saves PDF to disk and sanitizes custom filename', async () => {
      const client = new PesuClient({
        sessionId: 'valid_mock_session_12345',
        baseUrl: mockServer.baseUrl,
      });
      const res = await client.downloadCourseMaterial(
        'doc_uuid_1111',
        'UE23CS351A: Unit 1? Slides',
        tempDownloadDir
      );
      assert.ok(res.filename.includes('UE23CS351A_ Unit 1_ Slides.pdf'));
      assert.ok(fs.existsSync(res.path));
    });

    test('searchAndDownloadCourseMaterial smart downloader downloads materials', async () => {
      const client = new PesuClient({
        sessionId: 'valid_mock_session_12345',
        baseUrl: mockServer.baseUrl,
      });
      const res = await client.searchAndDownloadCourseMaterial(
        'Database',
        'Unit 1',
        'slides',
        tempDownloadDir
      );
      assert.ok(res.downloadedFiles.length >= 2);
      assert.ok(res.message.includes('Downloaded'));
    });

    test('searchAndDownloadCourseMaterial edge case: course not found', async () => {
      const client = new PesuClient({
        sessionId: 'valid_mock_session_12345',
        baseUrl: mockServer.baseUrl,
      });
      const res = await client.searchAndDownloadCourseMaterial(
        'QuantumComputingNonExistent',
        'Unit 1',
        'slides',
        tempDownloadDir
      );
      assert.strictEqual(res.downloadedFiles.length, 0);
      assert.ok(res.message.includes('No registered course found'));
    });

    test('searchAndDownloadCourseMaterial edge case: unit not found', async () => {
      const client = new PesuClient({
        sessionId: 'valid_mock_session_12345',
        baseUrl: mockServer.baseUrl,
      });
      const res = await client.searchAndDownloadCourseMaterial(
        'Database',
        'Unit 99',
        'slides',
        tempDownloadDir
      );
      assert.strictEqual(res.downloadedFiles.length, 0);
      assert.ok(res.message.includes('no unit found matching'));
    });
  });

  describe('Administrative & Exam Utility Operations', () => {
    test('getAssignments parses assignment table', async () => {
      const client = new PesuClient({
        sessionId: 'valid_mock_session_12345',
        baseUrl: mockServer.baseUrl,
      });
      const assignments = await client.getAssignments();
      assert.strictEqual(assignments.length, 1);
      assert.strictEqual(assignments[0].assignmentName, 'Assignment 1');
      assert.strictEqual(assignments[0].marksObtained, '10');
    });

    test('getSeatingInfo extracts room and desk info', async () => {
      const client = new PesuClient({
        sessionId: 'valid_mock_session_12345',
        baseUrl: mockServer.baseUrl,
      });
      const info = await client.getSeatingInfo();
      assert.ok(info.includes('Room: G04'));
      assert.ok(info.includes('Desk: 42'));
    });

    test('getProfile extracts structured fields and fallback regex matches', async () => {
      const client = new PesuClient({
        sessionId: 'valid_mock_session_12345',
        baseUrl: mockServer.baseUrl,
      });
      const prof = await client.getProfile();
      assert.strictEqual(prof['SRN'], 'PES1UG22CS999');
      assert.strictEqual(prof['Name'], 'Test Student');
      assert.strictEqual(prof['PUC Marks'], '96.5%');
      assert.strictEqual(prof['SSLC Marks'], '95.0%');
    });

    test('getCalendar parses academic events via regex', async () => {
      const client = new PesuClient({
        sessionId: 'valid_mock_session_12345',
        baseUrl: mockServer.baseUrl,
      });
      const cal = await client.getCalendar();
      assert.strictEqual(cal.length, 2);
      assert.strictEqual(cal[0].date, 'October 02, 2026');
      assert.strictEqual(cal[0].day, 'Friday');
      assert.ok(cal[0].event.includes('Gandhi Jayanti'));
    });

    test('getQuizzes returns current and old quiz schedules', async () => {
      const client = new PesuClient({
        sessionId: 'valid_mock_session_12345',
        baseUrl: mockServer.baseUrl,
      });
      const q = await client.getQuizzes();
      assert.strictEqual(q.currentSchedules.length, 1);
      assert.strictEqual(q.currentSchedules[0].subjectCode, 'CS351');
      assert.strictEqual(q.previousSchedules.length, 1);
      assert.strictEqual(q.previousSchedules[0].subjectCode, 'CS352');
    });

    test('checkHallTicket & downloadHallTicket when released', async () => {
      mockServer.hallTicketReleased = true;
      const client = new PesuClient({
        sessionId: 'valid_mock_session_12345',
        baseUrl: mockServer.baseUrl,
      });
      const check = await client.checkHallTicket();
      assert.strictEqual(check.isReleased, true);
      assert.strictEqual(check.activeEsaList.length, 1);
      assert.strictEqual(check.activeEsaList[0].esaId, '9924');

      const dl = await client.downloadHallTicket(undefined, tempDownloadDir);
      assert.strictEqual(dl.filename, 'HallTicket_9924.pdf');
      assert.ok(fs.existsSync(dl.path));
    });

    test('checkHallTicket & downloadHallTicket edge case when NOT released', async () => {
      mockServer.hallTicketReleased = false;
      const client = new PesuClient({
        sessionId: 'valid_mock_session_12345',
        baseUrl: mockServer.baseUrl,
      });
      const check = await client.checkHallTicket();
      assert.strictEqual(check.isReleased, false);
      assert.strictEqual(check.activeEsaList.length, 0);

      await assert.rejects(
        async () => await client.downloadHallTicket(undefined, tempDownloadDir),
        /Hall ticket is not currently released/
      );
    });

    test('getGrievances filters out "No data available" row', async () => {
      const client = new PesuClient({
        sessionId: 'valid_mock_session_12345',
        baseUrl: mockServer.baseUrl,
      });
      const tickets = await client.getGrievances();
      assert.strictEqual(tickets.length, 1);
      assert.strictEqual(tickets[0].ticketNumber, 'TKT-2026-001');
      assert.strictEqual(tickets[0].status, 'Resolved');
    });

    test('checkBacklogStatus returns correct availability boolean', async () => {
      const client = new PesuClient({
        sessionId: 'valid_mock_session_12345',
        baseUrl: mockServer.baseUrl,
      });
      mockServer.backlogAvailable = true;
      const resOpen = await client.checkBacklogStatus();
      assert.strictEqual(resOpen.isAvailable, true);

      mockServer.backlogAvailable = false;
      const resClosed = await client.checkBacklogStatus();
      assert.strictEqual(resClosed.isAvailable, false);
    });
  });
});
