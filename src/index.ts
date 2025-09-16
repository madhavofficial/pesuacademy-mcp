#!/usr/bin/env node
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import dotenv from 'dotenv';
import { PesuClient } from './pesu-client.js';

dotenv.config();

const client = new PesuClient();

const server = new Server(
  {
    name: 'pesuacademy-mcp',
    version: '1.0.0',
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

// Register tools
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: 'pesu_get_attendance',
        description:
          'Get course-wise attendance percentage, attended/total classes, and bunk/attendance advice for 75% and 85% thresholds.',
        inputSchema: {
          type: 'object',
          properties: {
            semester: {
              type: 'string',
              description: 'Optional semester name or ID (e.g. "Sem-5", "Sem-6", "3199"). Defaults to current.',
            },
          },
        },
      },
      {
        name: 'pesu_get_results',
        description: 'Get semester ESA results, SGPA, CGPA, total earned credits, and subject-wise grades & ISA marks.',
        inputSchema: {
          type: 'object',
          properties: {
            semester: {
              type: 'string',
              description: 'Optional semester name or ID (e.g. "Sem-5", "Sem-6"). Defaults to the latest completed semester.',
            },
          },
        },
      },
      {
        name: 'pesu_get_announcements',
        description: 'List recent university and department announcements with dates, headlines, and attachment IDs.',
        inputSchema: {
          type: 'object',
          properties: {
            limit: {
              type: 'number',
              description: 'Maximum number of announcements to return (default 15).',
            },
          },
        },
      },
      {
        name: 'pesu_get_announcement_details',
        description: 'Get full text and attachment details for a specific announcement ID.',
        inputSchema: {
          type: 'object',
          properties: {
            announcement_id: {
              type: 'number',
              description: 'The announcement ID (e.g. 7466).',
            },
          },
          required: ['announcement_id'],
        },
      },
      {
        name: 'pesu_download_announcement_attachment',
        description: 'Download an attached file (e.g. timetable PDF or circular) from an announcement to disk.',
        inputSchema: {
          type: 'object',
          properties: {
            attachment_id: {
              type: 'string',
              description: 'The document attachment ID (e.g. "6040").',
            },
            output_dir: {
              type: 'string',
              description: 'Local directory to save the file (default: "./downloads").',
            },
          },
          required: ['attachment_id'],
        },
      },
      {
        name: 'pesu_read_announcement_attachment',
        description: 'Download and extract text directly from a PDF attachment into context (great for reading timetables without opening a viewer).',
        inputSchema: {
          type: 'object',
          properties: {
            attachment_id: {
              type: 'string',
              description: 'The document attachment ID (e.g. "6040").',
            },
          },
          required: ['attachment_id'],
        },
      },
      {
        name: 'pesu_get_timetable',
        description: 'Get current class timetable, daily period schedule, subjects, and room numbers.',
        inputSchema: {
          type: 'object',
          properties: {},
        },
      },
      {
        name: 'pesu_get_courses',
        description: 'List registered courses for a given semester, course codes, titles, and internal course IDs.',
        inputSchema: {
          type: 'object',
          properties: {
            semester: {
              type: 'string',
              description: 'Semester name or ID (e.g. "Sem-5", "2915"). Defaults to current.',
            },
          },
        },
      },
      {
        name: 'pesu_get_course_units',
        description: 'List all syllabus units (Unit 1, Unit 2, etc.) for a specific course.',
        inputSchema: {
          type: 'object',
          properties: {
            course_content_id: {
              type: 'string',
              description: 'The internal course content ID (obtained from pesu_get_courses, e.g. "20970").',
            },
          },
          required: ['course_content_id'],
        },
      },
      {
        name: 'pesu_get_unit_topics',
        description: 'List all topics in a unit with counts of available slides, notes, assignments, and question banks.',
        inputSchema: {
          type: 'object',
          properties: {
            unit_content_id: {
              type: 'string',
              description: 'The unit content ID (obtained from pesu_get_course_units, e.g. "62019").',
            },
          },
          required: ['unit_content_id'],
        },
      },
      {
        name: 'pesu_get_topic_materials',
        description: 'Get downloadable documents (slides or notes) for a specific class topic in a unit.',
        inputSchema: {
          type: 'object',
          properties: {
            course_unit_id: { type: 'string', description: 'The course unit UUID' },
            subject_id: { type: 'string', description: 'The subject ID' },
            course_content_id: { type: 'string', description: 'The course content ID' },
            class_no: { type: 'string', description: 'Class number (e.g. "16")' },
            material_type: {
              type: 'string',
              enum: ['slides', 'notes'],
              description: 'Type of material: "slides" or "notes".',
            },
          },
          required: ['course_unit_id', 'subject_id', 'course_content_id', 'class_no'],
        },
      },
      {
        name: 'pesu_download_course_material',
        description: 'Download a specific course slide or note PDF using its document ID.',
        inputSchema: {
          type: 'object',
          properties: {
            doc_id: {
              type: 'string',
              description: 'Document UUID (e.g. "cda7170e-a14e-43e3-871a-2d81398bdbac").',
            },
            filename: {
              type: 'string',
              description: 'Optional custom filename to save as.',
            },
            output_dir: {
              type: 'string',
              description: 'Local directory to save the file (default: "./downloads").',
            },
          },
          required: ['doc_id'],
        },
      },
      {
        name: 'pesu_search_and_download_course_material',
        description:
          'Smart high-level downloader: Give a course query (e.g. "database", "machine learning", "python") and a unit (e.g. "unit 2", "2"), and it will automatically find and download all slides or notes to disk!',
        inputSchema: {
          type: 'object',
          properties: {
            course: {
              type: 'string',
              description: 'Course name or keyword (e.g. "Database", "Big Data", "Software Engineering").',
            },
            unit: {
              type: 'string',
              description: 'Unit name or number (e.g. "Unit 2", "2").',
            },
            material_type: {
              type: 'string',
              enum: ['slides', 'notes'],
              description: 'Whether to download "slides" or "notes" (default: "slides").',
            },
            output_dir: {
              type: 'string',
              description: 'Local directory to save the files (default: "./downloads").',
            },
          },
          required: ['course', 'unit'],
        },
      },
      {
        name: 'pesu_get_assignments',
        description: 'List course assignments, assignment types, submission status, due dates, evaluation status, and marks.',
        inputSchema: {
          type: 'object',
          properties: {
            semester: {
              type: 'string',
              description: 'Optional semester filter.',
            },
          },
        },
      },
      {
        name: 'pesu_get_seating_info',
        description: 'Check exam seating info (classroom and desk number) for upcoming ISA / ESA assessments.',
        inputSchema: {
          type: 'object',
          properties: {},
        },
      },
      {
        name: 'pesu_get_profile',
        description: 'Get student profile: SRN, PRN, branch, semester, section, email, mobile, and past academic marks.',
        inputSchema: {
          type: 'object',
          properties: {},
        },
      },
      {
        name: 'pesu_get_calendar',
        description: 'Get university academic calendar events, exam dates (ISA, ESA), and holidays.',
        inputSchema: {
          type: 'object',
          properties: {},
        },
      },
      {
        name: 'pesu_get_quizzes',
        description: 'List current scheduled quizzes and previous quiz scores/status.',
        inputSchema: {
          type: 'object',
          properties: {},
        },
      },
      {
        name: 'pesu_check_hall_ticket',
        description: 'Check if the End Semester Assessment (ESA) hall ticket is released by the university.',
        inputSchema: {
          type: 'object',
          properties: {},
        },
      },
      {
        name: 'pesu_download_hall_ticket',
        description: 'Download the official ESA hall ticket PDF to disk so the user can print it immediately.',
        inputSchema: {
          type: 'object',
          properties: {
            esa_id: {
              type: 'string',
              description: 'Optional ESA ID. Defaults to the active ESA.',
            },
            output_dir: {
              type: 'string',
              description: 'Directory to save the PDF (default: "./downloads").',
            },
          },
        },
      },
      {
        name: 'pesu_get_portal_credentials',
        description: 'Retrieve auto-provisioned student logins: Microsoft Teams credentials, Campus WiFi (Captive Portal), and MATLAB.',
        inputSchema: {
          type: 'object',
          properties: {},
        },
      },
      {
        name: 'pesu_get_grievances',
        description: 'List submitted student grievance redressal tickets and status.',
        inputSchema: {
          type: 'object',
          properties: {},
        },
      },
      {
        name: 'pesu_check_backlog_status',
        description: 'Check whether backlog exam registration is currently open.',
        inputSchema: {
          type: 'object',
          properties: {},
        },
      },
    ],
  };
});

// Tool Call Execution Handler
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    switch (name) {
      case 'pesu_get_attendance': {
        const res = await client.getAttendance(args?.semester as string | undefined);
        return {
          content: [{ type: 'text', text: JSON.stringify(res, null, 2) }],
        };
      }

      case 'pesu_get_results': {
        const res = await client.getResults(args?.semester as string | undefined);
        return {
          content: [{ type: 'text', text: JSON.stringify(res, null, 2) }],
        };
      }

      case 'pesu_get_announcements': {
        const limit = (args?.limit as number) || 15;
        const res = await client.getAnnouncements(limit);
        return {
          content: [{ type: 'text', text: JSON.stringify(res, null, 2) }],
        };
      }

      case 'pesu_get_announcement_details': {
        const id = args?.announcement_id as number;
        const res = await client.getAnnouncementDetails(id);
        return {
          content: [{ type: 'text', text: JSON.stringify(res, null, 2) }],
        };
      }

      case 'pesu_download_announcement_attachment': {
        const attachmentId = args?.attachment_id as string;
        const outDir = (args?.output_dir as string) || './downloads';
        const res = await client.downloadAnnouncementAttachment(attachmentId, outDir);
        return {
          content: [
            {
              type: 'text',
              text: `File downloaded successfully!\nFilename: ${res.filename}\nLocation: ${res.path}\nSize: ${(res.size / 1024).toFixed(1)} KB`,
            },
          ],
        };
      }

      case 'pesu_read_announcement_attachment': {
        const attachmentId = args?.attachment_id as string;
        const text = await client.readAnnouncementAttachmentText(attachmentId);
        return {
          content: [{ type: 'text', text }],
        };
      }

      case 'pesu_get_timetable': {
        const res = await client.getTimetable();
        return {
          content: [{ type: 'text', text: JSON.stringify(res, null, 2) }],
        };
      }

      case 'pesu_get_courses': {
        const res = await client.getCourses(args?.semester as string | undefined);
        return {
          content: [{ type: 'text', text: JSON.stringify(res, null, 2) }],
        };
      }

      case 'pesu_get_course_units': {
        const courseContentId = args?.course_content_id as string;
        const res = await client.getCourseUnits(courseContentId);
        return {
          content: [{ type: 'text', text: JSON.stringify(res, null, 2) }],
        };
      }

      case 'pesu_get_unit_topics': {
        const unitContentId = args?.unit_content_id as string;
        const res = await client.getUnitTopics(unitContentId);
        return {
          content: [{ type: 'text', text: JSON.stringify(res, null, 2) }],
        };
      }

      case 'pesu_get_topic_materials': {
        const { course_unit_id, subject_id, course_content_id, class_no, material_type } =
          args as any;
        const res = await client.getTopicDocuments(
          course_unit_id,
          subject_id,
          course_content_id,
          class_no,
          material_type || 'slides'
        );
        return {
          content: [{ type: 'text', text: JSON.stringify(res, null, 2) }],
        };
      }

      case 'pesu_download_course_material': {
        const docId = args?.doc_id as string;
        const filename = args?.filename as string | undefined;
        const outDir = (args?.output_dir as string) || './downloads';
        const res = await client.downloadCourseMaterial(docId, filename, outDir);
        return {
          content: [
            {
              type: 'text',
              text: `Course material downloaded successfully!\nFilename: ${res.filename}\nLocation: ${res.path}\nSize: ${(res.size / 1024).toFixed(1)} KB`,
            },
          ],
        };
      }

      case 'pesu_search_and_download_course_material': {
        const course = args?.course as string;
        const unit = args?.unit as string;
        const materialType = (args?.material_type as 'slides' | 'notes') || 'slides';
        const outDir = (args?.output_dir as string) || './downloads';
        const res = await client.searchAndDownloadCourseMaterial(course, unit, materialType, outDir);
        return {
          content: [{ type: 'text', text: JSON.stringify(res, null, 2) }],
        };
      }

      case 'pesu_get_assignments': {
        const res = await client.getAssignments(args?.semester as string | undefined);
        return {
          content: [{ type: 'text', text: JSON.stringify(res, null, 2) }],
        };
      }

      case 'pesu_get_seating_info': {
        const res = await client.getSeatingInfo();
        return {
          content: [{ type: 'text', text: res }],
        };
      }

      case 'pesu_get_profile': {
        const res = await client.getProfile();
        return {
          content: [{ type: 'text', text: JSON.stringify(res, null, 2) }],
        };
      }

      case 'pesu_get_calendar': {
        const res = await client.getCalendar();
        return {
          content: [{ type: 'text', text: JSON.stringify(res, null, 2) }],
        };
      }

      case 'pesu_get_quizzes': {
        const res = await client.getQuizzes();
        return {
          content: [{ type: 'text', text: JSON.stringify(res, null, 2) }],
        };
      }

      case 'pesu_check_hall_ticket': {
        const res = await client.checkHallTicket();
        return {
          content: [{ type: 'text', text: JSON.stringify(res, null, 2) }],
        };
      }

      case 'pesu_download_hall_ticket': {
        const esaId = args?.esa_id as string | undefined;
        const outDir = (args?.output_dir as string) || './downloads';
        const res = await client.downloadHallTicket(esaId, outDir);
        return {
          content: [
            {
              type: 'text',
              text: `Hall ticket downloaded successfully!\nFilename: ${res.filename}\nLocation: ${res.path}\nSize: ${(res.size / 1024).toFixed(1)} KB\nReady for printing.`,
            },
          ],
        };
      }

      case 'pesu_get_portal_credentials': {
        const res = await client.getPortalCredentials();
        return {
          content: [{ type: 'text', text: JSON.stringify(res, null, 2) }],
        };
      }

      case 'pesu_get_grievances': {
        const res = await client.getGrievances();
        return {
          content: [{ type: 'text', text: JSON.stringify(res, null, 2) }],
        };
      }

      case 'pesu_check_backlog_status': {
        const res = await client.checkBacklogStatus();
        return {
          content: [{ type: 'text', text: JSON.stringify(res, null, 2) }],
        };
      }

      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  } catch (error: any) {
    return {
      isError: true,
      content: [{ type: 'text', text: `Error: ${error.message || String(error)}` }],
    };
  }
});

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((error) => {
  console.error('Fatal server error:', error);
  process.exit(1);
});
