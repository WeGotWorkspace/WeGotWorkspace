@extends('mcp.layout')

@section('title', 'Sign in')

@section('content')
    <p class="mcp-eyebrow">Connect assistant</p>
    <h1>Sign in to connect an assistant</h1>
    <p>Connecting an assistant is a high-trust action. Sign in with your WeGotWorkspace username and password even if you already have a browser tab open.</p>
    @if (!empty($error))
        <p class="mcp-error" role="alert">{{ $error }}</p>
    @endif
    <form method="post" action="{{ url('/oauth/session') }}">
        <input type="hidden" name="intent" value="{{ $intent }}">
        <label class="mcp-field" for="username">Username</label>
        <input class="mcp-input" id="username" name="username" autocomplete="username" value="{{ $username ?? '' }}" required>
        <label class="mcp-field" for="password">Password</label>
        <input class="mcp-input" id="password" name="password" type="password" autocomplete="current-password" required>
        <button type="submit" class="mcp-btn mcp-btn--primary mcp-login-submit">Sign in</button>
    </form>
@endsection
