<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>@yield('title') — WeGotWorkspace</title>
    @include('mcp.partials.styles')
</head>
<body class="mcp-page @yield('bodyClass')">
    <main class="@yield('mainClass', 'mcp-card')">
        @yield('content')
    </main>
</body>
</html>
