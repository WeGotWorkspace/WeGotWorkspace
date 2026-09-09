<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Connect assistant — WeGotWorkspace</title>
    <style>
        body { font-family: system-ui, sans-serif; background: #f6f4ef; color: #1c1917; margin: 0; }
        .mcp-card { max-width: 32rem; margin: 3rem auto; background: #fff; border: 1px solid #e7e5e4; border-radius: 0.75rem; padding: 1.75rem; }
        h1 { font-size: 1.25rem; margin: 0 0 0.5rem; }
        p, li, label { color: #44403c; line-height: 1.5; }
        .mcp-origin { font-weight: 700; }
        .mcp-name { color: #78716c; font-size: 0.9rem; }
        .mcp-warn { background: #fff7ed; border: 1px solid #fed7aa; padding: 0.75rem; border-radius: 0.4rem; }
        .mcp-scope { display: flex; gap: 0.5rem; align-items: flex-start; margin: 0.4rem 0; }
        .mcp-scope-group { border: 0; margin: 0.9rem 0 0; padding: 0; }
        .mcp-scope-group legend { font-weight: 700; font-size: 0.95rem; padding: 0; margin: 0 0 0.2rem; }
        .mcp-actions { display: flex; gap: 0.75rem; margin-top: 1.25rem; }
        button, .mcp-deny { flex: 1; padding: 0.6rem; border-radius: 0.4rem; font-weight: 600; cursor: pointer; text-align: center; text-decoration: none; }
        button[type=submit] { border: 0; background: #44403c; color: #fff; }
        .mcp-deny { background: #fff; border: 1px solid #d6d3d1; color: #44403c; }
    </style>
</head>
<body>
    <main class="mcp-card">
        <h1>Allow <span class="mcp-origin">{{ $clientOrigin }}</span> to access this workspace?</h1>
        @if (!empty($clientName) && $clientName !== $clientOrigin)
            <p class="mcp-name">The client calls itself “{{ $clientName }}”. Treat the origin above as the real identity.</p>
        @endif
        <p>Signed in as <strong>{{ $username }}</strong>.</p>
        <p class="mcp-warn">Content you allow here leaves this instance and is sent to the assistant vendor’s model. You can revoke access later in Settings → Connected assistants.</p>
        <form method="post" action="{{ url('/oauth/authorize') }}">
            <input type="hidden" name="auth_token" value="{{ $authToken }}">
            <input type="hidden" name="intent" value="{{ $intent }}">
            <input type="hidden" name="client_id" value="{{ $client->id }}">
            <p>Permissions (uncheck any you do not want to grant):</p>
            @foreach ($scopeGroups as $group)
                <fieldset class="mcp-scope-group">
                    <legend>{{ $group['label'] }}</legend>
                    @foreach ($group['scopes'] as $scope)
                        <label class="mcp-scope">
                            <input type="checkbox" name="scope[]" value="{{ $scope->id }}" checked>
                            <span>
                                <strong>{{ $scope->id }}</strong>
                                — {{ $scopeCatalog[$scope->id] ?? $scope->description }}
                            </span>
                        </label>
                    @endforeach
                </fieldset>
            @endforeach
            <div class="mcp-actions">
                <button type="submit">Approve</button>
                <button type="submit" form="mcp-deny" class="mcp-deny">Deny</button>
            </div>
        </form>
        <form id="mcp-deny" method="post" action="{{ url('/oauth/authorize') }}" style="display:none">
            @method('DELETE')
            <input type="hidden" name="auth_token" value="{{ $authToken }}">
            <input type="hidden" name="intent" value="{{ $intent }}">
            <input type="hidden" name="client_id" value="{{ $client->id }}">
        </form>
    </main>
</body>
</html>
