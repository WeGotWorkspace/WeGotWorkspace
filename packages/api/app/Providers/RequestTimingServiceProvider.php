<?php

declare(strict_types=1);

namespace App\Providers;

use App\Support\Timing\RequestTimings;
use App\Support\Timing\TimedFilesystemAdapter;
use Illuminate\Database\Events\QueryExecuted;
use Illuminate\Database\Events\TransactionCommitted;
use Illuminate\Database\Events\TransactionCommitting;
use Illuminate\Filesystem\LocalFilesystemAdapter;
use Illuminate\Support\Facades\Event;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\ServiceProvider;
use League\Flysystem\Filesystem;
use League\Flysystem\Local\LocalFilesystemAdapter as LocalAdapter;
use League\Flysystem\UnixVisibility\PortableVisibilityConverter;
use League\Flysystem\Visibility;

/**
 * Feeds RequestTimings (#2244): database time from query and commit events,
 * storage time from the `wgw_local` disk driver. LogSlowRequest writes the
 * result for slow JMAP requests.
 */
final class RequestTimingServiceProvider extends ServiceProvider
{
    public function register(): void
    {
        $this->app->singleton(RequestTimings::class);
    }

    public function boot(): void
    {
        $timings = fn (): RequestTimings => $this->app->make(RequestTimings::class);

        Event::listen(QueryExecuted::class, static fn (QueryExecuted $event) => $timings()->addQuery($event->time));
        Event::listen(TransactionCommitting::class, static fn (TransactionCommitting $event) => $timings()->commitStarting($event->connectionName));
        Event::listen(TransactionCommitted::class, static fn (TransactionCommitted $event) => $timings()->commitFinished($event->connectionName));

        Storage::extend('wgw_local', fn ($app, array $config) => $this->timedLocalDisk($config, $timings()));
    }

    /**
     * The `local` driver, with Flysystem going through TimedFilesystemAdapter.
     * Laravel keeps the plain local adapter, so path(), isLocal() checks and
     * temporary URLs behave as before.
     *
     * @param  array<string, mixed>  $config
     */
    private function timedLocalDisk(array $config, RequestTimings $timings): LocalFilesystemAdapter
    {
        $visibility = PortableVisibilityConverter::fromArray(
            $config['permissions'] ?? [],
            $config['directory_visibility'] ?? $config['visibility'] ?? Visibility::PRIVATE,
        );
        $links = ($config['links'] ?? null) === 'skip' ? LocalAdapter::SKIP_LINKS : LocalAdapter::DISALLOW_LINKS;
        $adapter = new LocalAdapter($config['root'], $visibility, $config['lock'] ?? LOCK_EX, $links);

        $flysystem = new Filesystem(new TimedFilesystemAdapter($adapter, $timings), array_intersect_key($config, array_flip([
            'directory_visibility',
            'disable_asserts',
            'retain_visibility',
            'temporary_url',
            'url',
            'visibility',
        ])));

        return new LocalFilesystemAdapter($flysystem, $adapter, $config);
    }
}
