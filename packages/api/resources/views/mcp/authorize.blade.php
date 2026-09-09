@extends('mcp.layout')

@section('title', 'Connect assistant')
@section('mainClass', 'mcp-shell mcp-shell--wide')

@section('content')
    @php
        $avatarName = trim((string) $username);
        $avatarParts = preg_split('/\s+/u', $avatarName, -1, PREG_SPLIT_NO_EMPTY);
        $avatarLetters = [];
        if (is_array($avatarParts)) {
            foreach ($avatarParts as $part) {
                $avatarLetters[] = mb_strtoupper(mb_substr($part, 0, 1));
                if (count($avatarLetters) === 2) {
                    break;
                }
            }
        }
        $avatarInitials = $avatarLetters === [] ? '?' : implode('', $avatarLetters);
    @endphp
    <header class="mcp-header">
        <div class="mcp-avatar" role="img" aria-label="Signed in as {{ $username }}">{{ $avatarInitials }}</div>
        <h1 class="mcp-title">Connect assistant</h1>
        <p class="mcp-lead">
            Allow <span class="mcp-origin">{{ \App\Services\Mcp\McpRedirectUris::displayHost($clientOrigin) }}</span>
            to access your workspace?
        </p>
    </header>
    <form method="post" action="{{ url('/oauth/authorize') }}">
        <input type="hidden" name="auth_token" value="{{ $authToken }}">
        <input type="hidden" name="intent" value="{{ $intent }}">
        <input type="hidden" name="client_id" value="{{ $client->id }}">
        <div class="mcp-card">
            <p class="mcp-permissions-intro" id="mcp-permissions-heading">Permissions</p>
            <p class="mcp-permissions-hint" id="mcp-permissions-hint">
                Choose what this assistant may do.
            </p>
            <p class="mcp-warn" role="note">
                <strong class="mcp-warn__title">Content you allow here leaves this instance</strong>
                Data is sent to the assistant vendor’s model.
                You can revoke access later in Settings → Connected assistants.
            </p>
            <div class="mcp-scope-groups" role="group" aria-labelledby="mcp-permissions-heading" aria-describedby="mcp-permissions-hint">
                @foreach ($scopeGroups as $group)
                    @php
                        $groupLabel = (string) $group['label'];
                        $iconId = \App\Services\Mcp\McpScopes::consentAppIcon($groupLabel);
                    @endphp
                    <section class="mcp-scope-group">
                        <h2 class="mcp-scope-group__heading">
                            @if ($iconId)
                                <img
                                    class="mcp-app-icon"
                                    src="{{ url('/app-icons/'.$iconId.'.svg') }}"
                                    alt=""
                                    width="28"
                                    height="28"
                                >
                            @endif
                            {{ $groupLabel }}
                        </h2>
                        @foreach ($group['scopes'] as $scope)
                            @php
                                $scopeId = $scope->id;
                                $description = $scopeCatalog[$scopeId] ?? $scope->description;
                                $inputId = 'scope-'.preg_replace('/[^A-Za-z0-9_-]/', '-', $scopeId);
                                $descId = $inputId.'-desc';
                            @endphp
                            <div class="mcp-scope">
                                <span class="mcp-scope__desc" id="{{ $descId }}">{{ $description }}</span>
                                <span class="mcp-switch">
                                    <input
                                        id="{{ $inputId }}"
                                        type="checkbox"
                                        role="switch"
                                        name="scope[]"
                                        value="{{ $scopeId }}"
                                        checked
                                        aria-labelledby="{{ $descId }}"
                                    >
                                    <span class="mcp-switch__track" aria-hidden="true"></span>
                                </span>
                            </div>
                        @endforeach
                    </section>
                @endforeach
            </div>
        </div>
        <div class="mcp-actions">
            <button type="submit" form="mcp-deny" class="mcp-btn mcp-btn--secondary">Deny</button>
            <button type="submit" class="mcp-btn mcp-btn--primary">Allow</button>
        </div>
    </form>
    <form id="mcp-deny" method="post" action="{{ url('/oauth/authorize') }}" hidden>
        @method('DELETE')
        <input type="hidden" name="auth_token" value="{{ $authToken }}">
        <input type="hidden" name="intent" value="{{ $intent }}">
        <input type="hidden" name="client_id" value="{{ $client->id }}">
    </form>
@endsection
