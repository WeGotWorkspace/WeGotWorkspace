<?php

declare(strict_types=1);

namespace App\Services\Installer;

use App\Models\AppSetting;
use App\Services\Settings\SettingKeys;

final class InstallerAppSettingsWriter
{
    /**
     * @param  array<string, mixed>  $values
     */
    public function replaceMany(array $values): void
    {
        $allowed = array_flip(SettingKeys::all());
        foreach ($values as $key => $value) {
            if (isset($allowed[$key])) {
                AppSetting::setValue($key, $value);
            }
        }
    }
}
