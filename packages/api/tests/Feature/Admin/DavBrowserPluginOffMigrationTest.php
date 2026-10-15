<?php

declare(strict_types=1);

namespace Tests\Feature\Admin;

use App\Models\AppSetting;
use Tests\Support\WgwDatabaseTestCase;

final class DavBrowserPluginOffMigrationTest extends WgwDatabaseTestCase
{
    public function test_stored_browser_plugin_turns_off_unless_an_admin_set_it(): void
    {
        $this->setAppSetting('browser_plugin', true);

        $migration = require database_path('migrations/wgw/2026_10_12_000600_wgw_dav_browser_plugin_off.php');
        $migration->up();

        $this->assertFalse(AppSetting::getValue('browser_plugin'));

        $migration->down();
        $this->assertFalse(AppSetting::getValue('browser_plugin'));

        $this->setAppSetting('browser_plugin', true);
        $this->setAppSetting('browser_plugin_admin_set', true);
        $migration->up();

        $this->assertTrue(AppSetting::getValue('browser_plugin'));
        $this->assertTrue(AppSetting::getValue('browser_plugin_admin_set'));
    }
}
