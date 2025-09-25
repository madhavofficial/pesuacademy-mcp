# PESU Academy MCP Server 🎓

> ⚠️ **Disclaimer / Proof of Concept**: This is an independent open-source project and proof of concept. It is not affiliated with, endorsed by, or sponsored by PES University. Use responsibly and at your own discretion.

A Model Context Protocol (MCP) server for **PESU Academy** (`pesuacademy.com`).

Allows AI assistants (like Claude, Antigravity, Cursor, etc.) to securely query student attendance, view results, timetable, download course lecture slides & unit notes, check and download hall tickets, fetch announcements and PDF circulars, and more.

---

## 🚀 Available Tools

### 1. Attendance & Academics
* **`pesu_get_attendance`**: Fetches course-wise attendance percentages, attended vs. conducted classes, and calculates how many classes can be safely bunked (or must be attended) to maintain $\ge 75\%$ or $\ge 85\%$.
* **`pesu_get_results`**: Retrieves SGPA, CGPA, total credits, and course-by-course grades and marks breakdown.
* **`pesu_get_timetable`**: Retrieves daily period timetable, subjects, timings, and classrooms.
* **`pesu_get_profile`**: Retrieves student profile: SRN, PRN, branch, semester, section, and contact details.

### 2. Course Materials & Slides (Smart Retrieval)
* **`pesu_search_and_download_course_material`**: High-level smart downloader. Given a course (e.g. `"Database"`, `"Machine Learning"`, `"Python"`) and a unit (e.g. `"Unit 2"` or `"2"`), automatically discovers and downloads all lecture slides or unit notes directly to your local computer!
* **`pesu_get_courses`**: Lists registered courses for any semester.
* **`pesu_get_course_units`**: Lists syllabus units for a course.
* **`pesu_get_unit_topics`**: Lists all topics, class numbers, and available materials in a unit.
* **`pesu_get_topic_materials`**: Discovers slide and note documents for a topic.
* **`pesu_download_course_material`**: Downloads any slide or note PDF to disk.

### 3. Announcements & Document Access
* **`pesu_get_announcements`**: Lists recent university and department circulars.
* **`pesu_get_announcement_details`**: Retrieves full announcement body and attachment IDs.
* **`pesu_download_announcement_attachment`**: Downloads attached files (e.g., timetable PDFs, circulars) to your computer.
* **`pesu_read_announcement_attachment`**: Reads and parses text directly from PDF attachments into the AI's context.

### 4. Examinations & Hall Ticket
* **`pesu_check_hall_ticket`**: Checks if the upcoming End Semester Assessment (ESA) hall ticket is released.
* **`pesu_download_hall_ticket`**: Downloads the official ESA hall ticket PDF to disk for printing.
* **`pesu_get_seating_info`**: Retrieves exam room and seat number for upcoming tests.
* **`pesu_get_quizzes`**: Lists upcoming quiz schedules and past scores.
* **`pesu_get_assignments`**: Checks homework deadlines, submission status, and evaluation marks.

### 5. Administrative & Campus Utility
* **`pesu_get_calendar`**: Lists university calendar events, exam dates, and holidays.
* **`pesu_get_grievances`**: Lists student grievance redressal tickets.
* **`pesu_check_backlog_status`**: Checks whether backlog registration is open.

---

## 🛠️ Configuration

Create or edit `.env` in the root directory:

```env
# Option A: Session ID (Fastest & Zero Credential Exposure)
PESU_SESSION_ID=your_session_id_here

# Option B: Login Credentials (Auto-login)
PESU_USERNAME=PES1202XXXXXX
# Note: Wrap in quotes if your password contains special characters like #, $, etc.
PESU_PASSWORD="your_password#"
```

---

## 🔌 Integration with MCP Clients

### 1. macOS Setup

In your MCP config file (e.g. `~/.gemini/antigravity/mcp_config.json` or `~/Library/Application Support/Claude/claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "pesuacademy": {
      "command": "node",
      "args": ["/Users/madhavjayam/pesuacademy-mcp/dist/index.js"],
      "env": {
        "PESU_SESSION_ID": "your_session_id_here"
      }
    }
  }
}
```
*(If `node` is not in standard system PATH, use `/opt/homebrew/bin/node` or run `which node`)*

### 2. Windows Setup

In your MCP config file (e.g. `%APPDATA%\Claude\claude_desktop_config.json` or Antigravity `mcp_config.json`):

```json
{
  "mcpServers": {
    "pesuacademy": {
      "command": "node",
      "args": ["C:\\path\\to\\pesuacademy-mcp\\dist\\index.js"],
      "env": {
        "PESU_SESSION_ID": "your_session_id_here"
      }
    }
  }
}
```
*(Tip: On Windows, use double backslashes `\\\\` in JSON file paths, or forward slashes `C:/path/to/...`)*

---

### 💻 Cross-Platform Notes (Windows & macOS)

* **Illegal Filename Sanitization**: On Windows, filenames containing `< > : " / \\ | ? *` (common in university course names like `UE23CS351A: DBMS`) are automatically sanitized into clean filenames.
* **Output Directories**: When specifying `outputDir` or leaving it blank, the server automatically defaults to `~/Downloads/PESU_Academy/` on macOS and `%USERPROFILE%\\Downloads\\PESU_Academy\\` on Windows using Node's cross-platform `os.homedir()`.
* **Path Traversal & Slashes**: Uses native `path.join` and `path.resolve` for seamless execution regardless of shell or operating system.

---

## 📦 Development & Building

```bash
# Install dependencies
npm install

# Run automated test suite (83 unit & integration tests)
npm test

# Build TypeScript
npm run build

# Run the server
npm start
```
