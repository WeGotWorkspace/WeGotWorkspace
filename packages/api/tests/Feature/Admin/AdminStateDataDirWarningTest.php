<?php

declare(strict_types=1);

namespace Tests\Feature\Admin;

use App\Services\Admin\AdminStateService;
use App\Support\WgwInstallConfig;
use Tests\Support\WgwDatabaseTestCase;

final class AdminStateDataDirWarningTest extends WgwDatabaseTestCase
{
    public function test_warns_when_the_data_directory_is_inside_the_published_tree(): void
    {
        config(['app.debug' => false, 'app.url' => 'https://wgw.example.test']);
        $this->app['env'] = 'production';
        $install = app(WgwInstallConfig::class)->installRoot();
        config(['wgw.data_dir' => rtrim(str_replace('\\', '/', $install), '/').'/wgw-content']);
        app()->forgetInstance(AdminStateService::class);

        $warnings = app(AdminStateService::class)->snapshot('alice')['securityWarnings'];

        $this->assertContains(
            'The data directory is inside the published website. Move it outside the web root so the database and signing key are not downloadable.',
            $warnings,
        );
    }

    public function test_does_not_warn_when_the_data_directory_is_outside_the_install(): void
    {
        $outside = sys_get_temp_dir().'/wgw-admin-data-'.uniqid('', true);
        mkdir($outside, 0775, true);
        config([
            'app.debug' => false,
            'app.url' => 'https://wgw.example.test',
            'wgw.data_dir' => $outside,
        ]);
        $this->app['env'] = 'production';
        app()->forgetInstance(AdminStateService::class);

        try {
            $warnings = app(AdminStateService::class)->snapshot('alice')['securityWarnings'];
        } finally {
            @rmdir($outside);
        }

        $this->assertNotContains(
            'The data directory is inside the published website. Move it outside the web root so the database and signing key are not downloadable.',
            $warnings,
        );
    }
}
