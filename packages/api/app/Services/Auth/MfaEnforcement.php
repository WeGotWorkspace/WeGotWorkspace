<?php

declare(strict_types=1);

namespace App\Services\Auth;

use App\Models\AppSetting;
use App\Services\Settings\SettingKeys;

/**
 * Reads auth_mfa_required. The admin write route arrives with enforcement.
 */
final class MfaEnforcement
{
    public function isRequired(): bool
    {
        return AppSetting::getValue(SettingKeys::AUTH_MFA_REQUIRED, false) === true;
    }
}
