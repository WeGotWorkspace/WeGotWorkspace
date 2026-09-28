<?php

declare(strict_types=1);

namespace App\Services\Mcp;

use App\Models\AppSetting;
use App\Services\Settings\SettingKeys;
use Laravel\Passport\Passport;

/**
 * Instance switch for Connected assistants (`SettingKeys::MCP_ENABLED`, default off).
 *
 * This AppSetting is the only switch and an env var must not override it.
 */
final class McpEnabled
{
    public function isOn(): bool
    {
        return (bool) AppSetting::getValue(SettingKeys::MCP_ENABLED, false);
    }

    public function revokeAllGrants(): void
    {
        Passport::token()->newQuery()->where('revoked', false)->update(['revoked' => true]);
        Passport::refreshToken()->newQuery()->where('revoked', false)->update(['revoked' => true]);
        Passport::authCode()->newQuery()->where('revoked', false)->update(['revoked' => true]);
    }
}
