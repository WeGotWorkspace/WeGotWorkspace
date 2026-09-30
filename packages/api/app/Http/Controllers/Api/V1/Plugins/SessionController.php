<?php

declare(strict_types=1);

namespace App\Http\Controllers\Api\V1\Plugins;

use App\Http\Middleware\AuthenticateWgwApi;
use App\Services\Auth\UiSessionService;
use App\Services\Installer\InstallerWebBase;
use App\Services\Plugins\PluginRegistryService;
use App\Support\WgwSettings;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

final class SessionController
{
    public function __construct(
        private PluginRegistryService $plugins,
        private UiSessionService $uiSession,
    ) {}

    public function __invoke(Request $request, string $id): JsonResponse
    {
        $plugin = $this->findActivePlugin($id);
        if ($plugin === null) {
            return response()->json(['error' => 'plugin_not_found'], 404);
        }

        /** @var array{username: string} $principal */
        $principal = $request->attributes->get(AuthenticateWgwApi::PRINCIPAL_ATTRIBUTE);
        $cfg = WgwSettings::normalized();
        $realm = (string) ($cfg[WgwSettings::AUTH_REALM] ?? 'SabreDAV');

        $cookie = $this->uiSession->establish(
            $principal['username'],
            $realm,
            InstallerWebBase::detect(),
        );

        return response()->json(['ok' => true])->withCookie($cookie);
    }

    /**
     * @return array<string, mixed>|null
     */
    private function findActivePlugin(string $id): ?array
    {
        $id = trim($id);
        if ($id === '') {
            return null;
        }

        foreach ($this->plugins->list() as $plugin) {
            if ((string) $plugin['id'] === $id && $plugin['active']) {
                return $plugin;
            }
        }

        return null;
    }
}
