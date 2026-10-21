// Staff routes require a signing secret before they inspect a mocked session.
// Individual auth tests explicitly stub this value to exercise misconfiguration.
process.env.SESSION_SECRET ??= 'test-only-session-secret'
