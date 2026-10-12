<?php

declare(strict_types=1);

use App\Database\Migrations\WgwMigration;
use App\Models\AppSetting;

return new class extends WgwMigration
{
    public function up(): void
    {
        if (AppSetting::getValue('browser_plugin') !== true) {
            return;
        }

        if (AppSetting::getValue('browser_plugin_admin_set') !== null) {
            return;
        }

        AppSetting::setValue('browser_plugin', false);
    }

    public function down(): void
    {
        // No-op. An admin choice, or the off default, stays in place.
    }
};
