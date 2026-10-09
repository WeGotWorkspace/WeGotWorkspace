<?php

declare(strict_types=1);

namespace App\Console\Commands;

use Illuminate\Console\Command;
use Illuminate\Support\Facades\Http;

class CheckDavDiscovery extends Command
{
    protected $signature = 'wgw:check-dav-discovery';

    protected $description = 'Verify that /.well-known/caldav and /.well-known/carddav redirect to the DAV root (RFC 6764)';

    public function handle(): int
    {
        $base = rtrim((string) config('app.url'), '/');
        $failed = false;

        foreach (['caldav', 'carddav'] as $service) {
            $url = $base.'/.well-known/'.$service;

            try {
                $response = Http::withoutRedirecting()->timeout(10)->get($url);
            } catch (\Throwable $e) {
                $this->error("{$service}: request failed - ".$e->getMessage());
                $failed = true;

                continue;
            }

            $status = $response->status();
            $location = $response->header('Location');

            if (in_array($status, [301, 302, 307, 308], true) && $location) {
                $this->info("{$service}: OK ({$status} -> {$location})");

                continue;
            }

            $this->error("{$service}: FAILED (HTTP {$status})");
            $failed = true;
        }

        if ($failed) {
            $this->newLine();
            $this->warn('Automatic client discovery is not working on this installation.');
            $this->warn('Users must enter the full DAV URL manually: '.$base.'/');
            $this->warn('If this server runs nginx, add:');
            $this->line('  location = /.well-known/caldav  { return 301 '.$base.'/; }');
            $this->line('  location = /.well-known/carddav { return 301 '.$base.'/; }');

            return self::FAILURE;
        }

        return self::SUCCESS;
    }
}
