import { test, describe, before, after } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { createServer } from '../src/index.js';
import { PesuClient } from '../src/pesu-client.js';
import { MockPesuServer } from './mock-server.js';

describe('MCP Protocol Server Tool Suite (All 22 Operations & Edge Cases)', () => {
  let mockServer: MockPesuServer;
  let client: Client;
  let serverTransport: any;
  let clientTransport: any;
  const tempDownloadDir = path.join(process.cwd(), 'scratch/test_mcp_downloads');

  const EXPECTED_TOOL_NAMES = [
    'pesu_get_attendance',
    'pesu_get_results',
    'pesu_get_announcements',
    'pesu_get_announcement_details',
    'pesu_download_announcement_attachment',
    'pesu_read_announcement_attachment',
    'pesu_get_timetable',
    'pesu_get_courses',
    'pesu_get_course_units',
    'pesu_get_unit_topics',
    'pesu_get_topic_materials',
    'pesu_download_course_material',
    'pesu_search_and_download_course_material',
    'pesu_get_assignments',
    'pesu_get_seating_info',
    'pesu_get_profile',
    'pesu_get_calendar',
    'pesu_get_quizzes',
    'pesu_check_hall_ticket',
    'pesu_download_hall_ticket',
    'pesu_get_grievances',
    'pesu_check_backlog_status',
    'pesu_search_faculty',
    'pesu_get_faculty_details',
    'pesu_search_pyqs',
    'pesu_download_pyq',
  ];

  before(async () => {
    mockServer = new MockPesuServer();
    await mockServer.start();
    fs.mkdirSync(tempDownloadDir, { recursive: true });

    const pesuClient = new PesuClient({
      sessionId: 'valid_mock_session_12345',
      baseUrl: mockServer.baseUrl,
      staffBaseUrl: mockServer.baseUrl,
      libraryBaseUrl: mockServer.baseUrl,
    });

    const server = createServer(pesuClient);
    [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

    client = new Client({ name: 'mcp-test-runner', version: '1.0.0' }, { capabilities: {} });
    await server.connect(serverTransport);
    await client.connect(clientTransport);
  });

  after(async () => {
    await client.close();
    await mockServer.stop();
    if (fs.existsSync(tempDownloadDir)) {
      fs.rmSync(tempDownloadDir, { recursive: true, force: true });
    }
  });

  describe('tools/list operation', () => {
    test('lists exactly 26 registered tools with schema and descriptions', async () => {
      const list = await client.listTools();
      assert.strictEqual(list.tools.length, 26);

      const registeredNames = list.tools.map((t) => t.name);
      for (const expected of EXPECTED_TOOL_NAMES) {
        assert.ok(registeredNames.includes(expected), `Missing tool: ${expected}`);
      }

      for (const t of list.tools) {
        assert.ok(t.description && t.description.length > 0, `Tool ${t.name} is missing description`);
        assert.strictEqual(t.inputSchema.type, 'object', `Tool ${t.name} inputSchema is not object`);
      }
    });
  });

  describe('tools/call operations (Every tool tested individually)', () => {
    // 1. pesu_get_attendance
    test('Tool 1: pesu_get_attendance returns course attendance and bunk calculations', async () => {
      const res: any = await client.callTool({
        name: 'pesu_get_attendance',
        arguments: { semester: 'Sem-6' },
      });
      assert.strictEqual(res.isError, undefined);
      const data = JSON.parse(res.content[0].text);
      assert.strictEqual(data.semester, 'Sem-6');
      assert.ok(data.courses.length >= 2);
    });

    // 2. pesu_get_results
    test('Tool 2: pesu_get_results returns SGPA, CGPA and subject grades', async () => {
      const res: any = await client.callTool({
        name: 'pesu_get_results',
        arguments: {},
      });
      assert.strictEqual(res.isError, undefined);
      const data = JSON.parse(res.content[0].text);
      assert.strictEqual(data.sgpa, '9.15');
      assert.strictEqual(data.subjects[0].esaGrade, 'S');
    });

    // 3. pesu_get_announcements
    test('Tool 3: pesu_get_announcements returns list of circulars', async () => {
      const res: any = await client.callTool({
        name: 'pesu_get_announcements',
        arguments: { limit: 5 },
      });
      assert.strictEqual(res.isError, undefined);
      const data = JSON.parse(res.content[0].text);
      assert.ok(Array.isArray(data));
      assert.strictEqual(data[0].id, 7466);
    });

    // 4. pesu_get_announcement_details
    test('Tool 4: pesu_get_announcement_details returns full circular body', async () => {
      const res: any = await client.callTool({
        name: 'pesu_get_announcement_details',
        arguments: { announcement_id: 7466 },
      });
      assert.strictEqual(res.isError, undefined);
      const data = JSON.parse(res.content[0].text);
      assert.strictEqual(data.id, 7466);
      assert.strictEqual(data.attachmentId, '6040');
    });

    // 5. pesu_download_announcement_attachment
    test('Tool 5: pesu_download_announcement_attachment downloads circular PDF to disk', async () => {
      const res: any = await client.callTool({
        name: 'pesu_download_announcement_attachment',
        arguments: { attachment_id: '6040', output_dir: tempDownloadDir },
      });
      assert.strictEqual(res.isError, undefined);
      assert.ok(res.content[0].text.includes('downloaded successfully'));
      assert.ok(fs.existsSync(path.join(tempDownloadDir, 'Circular_6040.pdf')));
    });

    // 6. pesu_read_announcement_attachment
    test('Tool 6: pesu_read_announcement_attachment parses PDF text directly into response', async () => {
      const res: any = await client.callTool({
        name: 'pesu_read_announcement_attachment',
        arguments: { attachment_id: '6040' },
      });
      assert.strictEqual(res.isError, undefined);
      assert.ok(res.content[0].text.includes('PESU Circular Test Content'));
    });

    // 7. pesu_get_timetable
    test('Tool 7: pesu_get_timetable retrieves daily schedule and batch details', async () => {
      const res: any = await client.callTool({
        name: 'pesu_get_timetable',
        arguments: {},
      });
      assert.strictEqual(res.isError, undefined);
      const data = JSON.parse(res.content[0].text);
      assert.strictEqual(data.className, 'CSE-6A');
      assert.strictEqual(data.section, 'A');
    });

    // 8. pesu_get_courses
    test('Tool 8: pesu_get_courses lists registered courses for semester', async () => {
      const res: any = await client.callTool({
        name: 'pesu_get_courses',
        arguments: { semester: 'Sem-6' },
      });
      assert.strictEqual(res.isError, undefined);
      const data = JSON.parse(res.content[0].text);
      assert.strictEqual(data[0].code, 'UE23CS351A');
    });

    // 9. pesu_get_course_units
    test('Tool 9: pesu_get_course_units retrieves syllabus units for courseContentId', async () => {
      const res: any = await client.callTool({
        name: 'pesu_get_course_units',
        arguments: { course_content_id: '20970' },
      });
      assert.strictEqual(res.isError, undefined);
      const data = JSON.parse(res.content[0].text);
      assert.strictEqual(data.units.length, 2);
    });

    // 10. pesu_get_unit_topics
    test('Tool 10: pesu_get_unit_topics retrieves topics and resource counts', async () => {
      const res: any = await client.callTool({
        name: 'pesu_get_unit_topics',
        arguments: { unit_content_id: '62019' },
      });
      assert.strictEqual(res.isError, undefined);
      const data = JSON.parse(res.content[0].text);
      assert.strictEqual(data.length, 1);
      assert.strictEqual(data[0].slidesCount, 2);
    });

    // 11. pesu_get_topic_materials
    test('Tool 11: pesu_get_topic_materials retrieves document IDs for class topic', async () => {
      const res: any = await client.callTool({
        name: 'pesu_get_topic_materials',
        arguments: {
          course_unit_id: 'U101',
          subject_id: 'SUB201',
          course_content_id: 'CC301',
          class_no: '1',
          material_type: 'slides',
        },
      });
      assert.strictEqual(res.isError, undefined);
      const data = JSON.parse(res.content[0].text);
      assert.strictEqual(data.length, 2);
      assert.strictEqual(data[0].docId, 'doc_uuid_1111');
    });

    // 12. pesu_download_course_material
    test('Tool 12: pesu_download_course_material saves slide document PDF', async () => {
      const res: any = await client.callTool({
        name: 'pesu_download_course_material',
        arguments: {
          doc_id: 'doc_uuid_1111',
          filename: 'DBMS_Unit1_Slides',
          output_dir: tempDownloadDir,
        },
      });
      assert.strictEqual(res.isError, undefined);
      assert.ok(res.content[0].text.includes('downloaded successfully'));
      assert.ok(fs.existsSync(path.join(tempDownloadDir, 'DBMS_Unit1_Slides.pdf')));
    });

    // 13. pesu_search_and_download_course_material
    test('Tool 13: pesu_search_and_download_course_material smart downloader retrieves all materials', async () => {
      const res: any = await client.callTool({
        name: 'pesu_search_and_download_course_material',
        arguments: {
          course: 'Database',
          unit: 'Unit 1',
          material_type: 'slides',
          output_dir: tempDownloadDir,
        },
      });
      assert.strictEqual(res.isError, undefined);
      const data = JSON.parse(res.content[0].text);
      assert.ok(data.downloadedFiles.length >= 2);
    });

    // 14. pesu_get_assignments
    test('Tool 14: pesu_get_assignments lists assignment statuses and marks', async () => {
      const res: any = await client.callTool({
        name: 'pesu_get_assignments',
        arguments: {},
      });
      assert.strictEqual(res.isError, undefined);
      const data = JSON.parse(res.content[0].text);
      assert.strictEqual(data[0].assignmentName, 'Assignment 1');
      assert.strictEqual(data[0].marksObtained, '10');
    });

    // 15. pesu_get_seating_info
    test('Tool 15: pesu_get_seating_info returns examination desk information', async () => {
      const res: any = await client.callTool({
        name: 'pesu_get_seating_info',
        arguments: {},
      });
      assert.strictEqual(res.isError, undefined);
      assert.ok(res.content[0].text.includes('Room: G04'));
      assert.ok(res.content[0].text.includes('Desk: 42'));
    });

    // 16. pesu_get_profile
    test('Tool 16: pesu_get_profile returns student details and prior scores', async () => {
      const res: any = await client.callTool({
        name: 'pesu_get_profile',
        arguments: {},
      });
      assert.strictEqual(res.isError, undefined);
      const data = JSON.parse(res.content[0].text);
      assert.strictEqual(data['SRN'], 'PES1UG22CS999');
      assert.strictEqual(data['Name'], 'Test Student');
    });

    // 17. pesu_get_calendar
    test('Tool 17: pesu_get_calendar returns university schedule events', async () => {
      const res: any = await client.callTool({
        name: 'pesu_get_calendar',
        arguments: {},
      });
      assert.strictEqual(res.isError, undefined);
      const data = JSON.parse(res.content[0].text);
      assert.strictEqual(data.length, 2);
      assert.strictEqual(data[0].date, 'October 02, 2026');
    });

    // 18. pesu_get_quizzes
    test('Tool 18: pesu_get_quizzes returns current and past quiz tests', async () => {
      const res: any = await client.callTool({
        name: 'pesu_get_quizzes',
        arguments: {},
      });
      assert.strictEqual(res.isError, undefined);
      const data = JSON.parse(res.content[0].text);
      assert.strictEqual(data.currentSchedules[0].subjectCode, 'CS351');
    });

    // 19. pesu_check_hall_ticket
    test('Tool 19: pesu_check_hall_ticket verifies ESA status', async () => {
      const res: any = await client.callTool({
        name: 'pesu_check_hall_ticket',
        arguments: {},
      });
      assert.strictEqual(res.isError, undefined);
      const data = JSON.parse(res.content[0].text);
      assert.strictEqual(data.isReleased, true);
    });

    // 20. pesu_download_hall_ticket
    test('Tool 20: pesu_download_hall_ticket saves printable PDF', async () => {
      const res: any = await client.callTool({
        name: 'pesu_download_hall_ticket',
        arguments: { output_dir: tempDownloadDir },
      });
      assert.strictEqual(res.isError, undefined);
      assert.ok(res.content[0].text.includes('Hall ticket downloaded successfully'));
      assert.ok(fs.existsSync(path.join(tempDownloadDir, 'HallTicket_9924.pdf')));
    });

    // 21. pesu_get_grievances
    test('Tool 21: pesu_get_grievances lists student tickets', async () => {
      const res: any = await client.callTool({
        name: 'pesu_get_grievances',
        arguments: {},
      });
      assert.strictEqual(res.isError, undefined);
      const data = JSON.parse(res.content[0].text);
      assert.strictEqual(data.length, 1);
      assert.strictEqual(data[0].ticketNumber, 'TKT-2026-001');
    });

    // 22. pesu_check_backlog_status
    test('Tool 22: pesu_check_backlog_status reports exam registration availability', async () => {
      const res: any = await client.callTool({
        name: 'pesu_check_backlog_status',
        arguments: {},
      });
      assert.strictEqual(res.isError, undefined);
      const data = JSON.parse(res.content[0].text);
      assert.strictEqual(data.isAvailable, true);
    });

    // 23. pesu_search_faculty
    test('Tool 23: pesu_search_faculty searches professor directory', async () => {
      const res: any = await client.callTool({
        name: 'pesu_search_faculty',
        arguments: { query: 'Shankar' },
      });
      assert.strictEqual(res.isError, undefined);
      const data = JSON.parse(res.content[0].text);
      assert.strictEqual(data.length, 1);
      assert.strictEqual(data[0].name, 'Geetha Shankar');
    });

    // 24. pesu_get_faculty_details
    test('Tool 24: pesu_get_faculty_details fetches profile contacts', async () => {
      const res: any = await client.callTool({
        name: 'pesu_get_faculty_details',
        arguments: { faculty_id: 'nm1332' },
      });
      assert.strictEqual(res.isError, undefined);
      const data = JSON.parse(res.content[0].text);
      assert.strictEqual(data.name, 'Geetha Shankar');
      assert.strictEqual(data.email, 'geethashankar@pes.edu');
    });

    // 25. pesu_search_pyqs
    test('Tool 25: pesu_search_pyqs queries library question papers', async () => {
      const res: any = await client.callTool({
        name: 'pesu_search_pyqs',
        arguments: { query: 'Operating Systems' },
      });
      assert.strictEqual(res.isError, undefined);
      const data = JSON.parse(res.content[0].text);
      assert.strictEqual(data.results.length, 1);
      assert.strictEqual(data.results[0].courseCode, 'UE21CS242B');
    });

    // 26. pesu_download_pyq
    test('Tool 26: pesu_download_pyq downloads paper PDF', async () => {
      const res: any = await client.callTool({
        name: 'pesu_download_pyq',
        arguments: {
          download_path: 'digital/qp/test_qp.pdf',
          output_dir: tempDownloadDir,
          custom_filename: 'MCP_Test_PYQ.pdf',
        },
      });
      assert.strictEqual(res.isError, undefined);
      assert.ok(res.content[0].text.includes('PYQ downloaded successfully'));
      assert.ok(fs.existsSync(path.join(tempDownloadDir, 'MCP_Test_PYQ.pdf')));
    });
  });

  describe('MCP Protocol Edge Cases & Error Handling', () => {
    test('unknown tool request returns error response without crashing server', async () => {
      const res: any = await client.callTool({
        name: 'invalid_nonexistent_tool',
        arguments: {},
      });
      assert.strictEqual(res.isError, true);
      assert.ok(res.content[0].text.includes('Unknown tool: invalid_nonexistent_tool'));
    });

    test('missing required arguments catches error and returns isError: true', async () => {
      const res: any = await client.callTool({
        name: 'pesu_download_course_material',
        arguments: {}, // missing required doc_id
      });
      assert.strictEqual(res.isError, true);
      assert.ok(res.content[0].text.includes('Document ID is required'));
    });

    test('tool error when hall ticket not released returns formatted error', async () => {
      mockServer.hallTicketReleased = false;
      const res: any = await client.callTool({
        name: 'pesu_download_hall_ticket',
        arguments: {},
      });
      assert.strictEqual(res.isError, true);
      assert.ok(res.content[0].text.includes('Hall ticket is not currently released'));
      mockServer.hallTicketReleased = true; // reset
    });
  });
});
