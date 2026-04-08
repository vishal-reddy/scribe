-- Sample document for testing
INSERT INTO documents (id, title, content, markdown, created_at, updated_at, created_by, last_edited_by)
VALUES (
  'sample-doc-1',
  'Welcome to Scribe',
  '', -- Empty Y.js state initially
  '# Welcome to Scribe\n\nThis is a sample document to get you started.',
  unixepoch(),
  unixepoch(),
  'user',
  'user'
);
