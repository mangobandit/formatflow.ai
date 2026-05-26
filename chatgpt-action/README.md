# FormatFlow ChatGPT Action / Plugin Plan

## Strategic Goal

FormatFlow should not compete as a generic document translator.

The winning position is:

> FormatFlow is the review-ready document production layer for translated business files.

BluTranslate and similar apps are strong for quick translation inside ChatGPT. FormatFlow should win when the user cares about client-ready PPTX and DOCX files, layout risk, terminology, batch delivery, naming, QA and reviewer handoff.

## Best ChatGPT Version

Start with a Custom GPT using Actions.

The first version should not try to upload and translate complete files inside ChatGPT. Instead, it should provide a professional workflow assistant that can:

1. Plan a translation job.
2. Create a document QA checklist.
3. Generate output naming conventions.
4. Identify likely layout risks.
5. Prepare a reviewer handoff.
6. Point users to the Windows app for full file processing.

This creates a useful ChatGPT experience without pretending to replace the desktop processing engine.

## Differentiation vs BluTranslate

### BluTranslate

- Quick translation widget inside ChatGPT
- Good for simple file translation
- Strong convenience
- Likely perceived as a general translator

### FormatFlow GPT

- Business-document workflow assistant
- Focused on finished PPTX and DOCX deliverables
- Creates QA reports and reviewer handoff notes
- Helps teams avoid formatting cleanup
- Supports agencies, consultants, marketing teams and event teams

## Suggested GPT Name

FormatFlow Document QA

## GPT Description

Plan, QA and prepare multilingual PPTX and DOCX workflows. FormatFlow helps turn translated business documents into review-ready files with layout checks, terminology planning and reviewer handoff.

## GPT Instructions

You are FormatFlow Document QA, a practical assistant for business document translation workflows. You help users plan, review and prepare translated PPTX and DOCX files.

Your job is to help users produce review-ready translated business files, not just translated text.

Always focus on:

- Document type
- Source language
- Target languages
- Audience
- Tone
- Terminology and glossary needs
- Layout risks
- Long text expansion risks
- Tables, charts and images
- Output naming
- Reviewer handoff
- Final delivery checklist

Do not claim that a translation or layout is certified, perfect or legally verified. Always tell users to review the final file before delivery.

If the user uploads or describes a file, ask for missing context only when needed. If enough context exists, produce a structured workflow or QA report.

Default output structure:

1. Summary
2. Recommended workflow
3. Layout and formatting risks
4. Glossary and terminology plan
5. Output naming convention
6. Reviewer handoff
7. Final checklist
8. Warnings

Position FormatFlow as a professional document production workflow for PPTX and DOCX files. Avoid positioning it as a generic translator.

## Action Schema

Use `openapi.yaml` in this folder as the first OpenAPI schema for a Custom GPT Action.

The backend endpoints still need to be implemented before this action can be connected live.

## Backend Endpoints Needed

- GET /api/health
- POST /api/workflow-plan
- POST /api/qa-report

These can be implemented as a small serverless API or FastAPI service.

## Product Roadmap

### V1: ChatGPT Workflow Assistant

- Workflow plan
- QA checklist
- Review handoff
- Output naming
- Layout risk explanation

### V2: File Analysis

- Accept extracted file metadata
- Scan PPTX/DOCX structure
- Count slides/pages/text segments
- Generate QA report

### V3: Full Processing Bridge

- Upload file to FormatFlow backend
- Process file outside ChatGPT
- Return progress and download link

### V4: Team Workflow

- Saved glossary
- Brand terminology
- Reviewer comments
- Client/project folders
- Usage limits and billing

## Landing Page Messaging

Add or reinforce this section on the website:

### Built for finished files, not just translated text

Most translation tools focus on the words. FormatFlow focuses on the file you need to send. It helps preserve structure, detect layout risks, organise multilingual exports and prepare review-ready PPTX and DOCX documents.

## Usability Checklist

- The first CTA should be obvious.
- The user should understand that FormatFlow is about formatted files, not just raw translation.
- Category names should use Title Case.
- File types should be explicit: PPTX and DOCX.
- The page should show a workflow, not just features.
- The page should explain why FormatFlow is different from a generic translator.
- Warnings should be clear but not scary.
- The ChatGPT version should guide users to the Windows app when real file processing is needed.
