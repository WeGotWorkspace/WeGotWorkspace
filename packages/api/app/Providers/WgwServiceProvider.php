<?php

declare(strict_types=1);

namespace App\Providers;

use App\Auth\SabreUserProvider;
use App\Services\Auth\SabreCredentialValidator;
use App\Services\Installer\DnsInstallerIpv4Resolver;
use App\Services\Installer\InstallerIpv4Resolver;
use App\Services\Installer\WgwConfigMigrator;
use App\Services\Jmap\Blobs\DiskFreeSpaceSource;
use App\Services\Jmap\Blobs\FreeSpaceSource;
use App\Services\Jmap\Blobs\JmapBlobGarbageCollector;
use App\Services\Jmap\Blobs\JmapBlobReferenceGuard;
use App\Services\Jmap\Capabilities\JmapCapabilitySet;
use App\Services\Jmap\FileNodes\FileNodeContentHasher;
use App\Services\Jmap\JmapMethodDispatcher;
use App\Services\Jmap\JmapRequestContext;
use App\Storage\StoragePaths;
use App\Storage\WgwStorage;
use App\Support\WgwDatabaseProbe;
use App\Support\WgwInstallConfig;
use App\Support\WgwRuntimeEnvBridge;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\ServiceProvider;

final class WgwServiceProvider extends ServiceProvider
{
    public function register(): void
    {
        $this->app->singleton(WgwInstallConfig::class);
        $this->app->singleton(InstallerIpv4Resolver::class, DnsInstallerIpv4Resolver::class);
        $this->app->singleton(WgwDatabaseProbe::class);
        $this->app->singleton(StoragePaths::class);
        $this->app->singleton(WgwStorage::class);
        $this->app->scoped(JmapRequestContext::class);
        $this->app->scoped(FileNodeContentHasher::class);
        $this->app->singleton(FreeSpaceSource::class, DiskFreeSpaceSource::class);

        // JMAP envelope: the method-handler and capability-provider lists are
        // class constants (autowiring cannot construct lists); resolving them
        // here keeps the services free of container references.
        $this->app->singleton(
            JmapMethodDispatcher::class,
            fn ($app): JmapMethodDispatcher => new JmapMethodDispatcher(
                array_map($app->make(...), JmapMethodDispatcher::METHODS),
                $app->make(JmapRequestContext::class),
            ),
        );
        $this->app->singleton(
            JmapCapabilitySet::class,
            fn ($app): JmapCapabilitySet => new JmapCapabilitySet(
                $app->make(JmapMethodDispatcher::class),
                array_map($app->make(...), JmapCapabilitySet::PROVIDERS),
            ),
        );
        $this->app->singleton(
            JmapBlobReferenceGuard::class,
            fn ($app): JmapBlobReferenceGuard => new JmapBlobReferenceGuard(
                array_map($app->make(...), JmapBlobGarbageCollector::CHECKERS),
            ),
        );
    }

    public function boot(): void
    {
        Auth::provider('sabre', function ($app): SabreUserProvider {
            return new SabreUserProvider($app->make(SabreCredentialValidator::class));
        });

        $this->app->make(WgwConfigMigrator::class)->migrateIfNeeded(clearConfig: false);
        WgwRuntimeEnvBridge::apply($this->app->make(WgwInstallConfig::class));

        $install = $this->app->make(WgwInstallConfig::class);
        $data = rtrim($install->dataDir(), '/');
        $files = rtrim($install->filesDir(), '/');

        $wgw = (array) config('database.connections.wgw', []);
        if (($wgw['driver'] ?? '') === 'sqlite') {
            $database = (string) ($wgw['database'] ?? '');
            if ($database !== '' && $database !== ':memory:' && ! $this->isAbsolutePath($database)) {
                $wgw['database'] = $install->resolveInstallPath($database);
            }
        }

        config([
            'wgw.data_dir' => $data,
            'filesystems.disks.wgw_data.root' => $data,
            'filesystems.disks.wgw_files.root' => $files,
            'filesystems.disks.wgw_notes.root' => $files,
            'database.connections.wgw' => $wgw,
        ]);
    }

    private function isAbsolutePath(string $path): bool
    {
        if ($path !== '' && $path[0] === '/') {
            return true;
        }

        return \PHP_OS_FAMILY === 'Windows'
            && strlen($path) > 2
            && ctype_alpha($path[0])
            && $path[1] === ':';
    }
}
