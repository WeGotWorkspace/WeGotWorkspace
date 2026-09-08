<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Sign in — WeGotWorkspace</title>
    <style>
        body { font-family: system-ui, sans-serif; background: #f6f4ef; color: #1c1917; margin: 0; }
        .mcp-card { max-width: 28rem; margin: 4rem auto; background: #fff; border: 1px solid #e7e5e4; border-radius: 0.75rem; padding: 1.75rem; }
        h1 { font-size: 1.25rem; margin: 0 0 0.5rem; }
        p { color: #57534e; line-height: 1.5; }
        label { display: block; font-weight: 600; margin: 0.75rem 0 0.25rem; }
        input { width: 100%; box-sizing: border-box; padding: 0.5rem 0.6rem; border: 1px solid #d6d3d1; border-radius: 0.4rem; }
        button { margin-top: 1rem; width: 100%; padding: 0.6rem; border: 0; border-radius: 0.4rem; background: #44403c; color: #fff; font-weight: 600; cursor: pointer; }
        .mcp-error { background: #fef2f2; color: #991b1b; padding: 0.6rem 0.75rem; border-radius: 0.4rem; }
    </style>
</head>
<body>
    <main class="mcp-card">
        <h1>Sign in to connect an assistant</h1>
        <p>Connecting an assistant is a high-trust action. Sign in with your WeGotWorkspace username and password even if you already have a browser tab open.</p>
        @if (!empty($error))
            <p class="mcp-error" role="alert">{{ $error }}</p>
        @endif
        <form method="post" action="{{ url('/oauth/session') }}">
            <input type="hidden" name="intent" value="{{ $intent }}">
            <label for="username">Username</label>
            <input id="username" name="username" autocomplete="username" value="{{ $username ?? '' }}" required>
            <label for="password">Password</label>
            <input id="password" name="password" type="password" autocomplete="current-password" required>
            <button type="submit">Sign in</button>
        </form>
    </main>
</body>
</html>
