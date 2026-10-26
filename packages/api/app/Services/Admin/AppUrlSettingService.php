<?php

declare(strict_types=1);

namespace App\Services\Admin;

use App\Exceptions\ApiHttpException;
use App\Models\AppSetting;
use App\Services\Installer\AppUrlCandidate;
use App\Services\Installer\EnvFileWriter;
use App\Services\Settings\SettingKeys;
use App\Support\WgwApiEnvFile;

/**
 * Writes an admin-confirmed APP_URL. The request Host is not a source.
 *
 * APP_URL stays in packages/api/.env: the trusted-host check reads it on
 * every request. When the file cannot be written, the 409 names the reason
 * and the exact line the admin should set by hand (#1583).
 */
final class AppUrlSettingService
{
    public function __construct(
        private EnvFileWriter $envFiles,
    ) {}

    public function save(string $url): string
    {
        $normalized = AppUrlCandidate::normalize($url, $this->installBase());
        if ($normalized === null) {
            throw new ApiHttpException(
                422,
                'Enter an http or https address with a host, no user info, no query, and no path other than the install base.',
            );
        }

        $line = 'APP_URL='.WgwApiEnvFile::quoteValue($normalized);
        if (app()->configurationIsCached()) {
            throw new ApiHttpException(409, 'The configuration is cached, so packages/api/.env is not read. Add this line there, then run php artisan config:clear: '.$line);
        }
        $envPath = app()->environmentFilePath();
        if (! is_file($envPath)) {
            throw new ApiHttpException(409, 'packages/api/.env does not exist. Create it from packages/api/.env.example and add this line: '.$line);
        }
        // The writer could still replace a read-only file through its folder,
        // but that would override the operator and hand the file to the web user.
        if (! is_writable($envPath)) {
            throw new ApiHttpException(409, 'packages/api/.env is read-only, so it is left alone. Add this line there by hand: '.$line);
        }

        $wrote = $this->envFiles->update($envPath, static function (string $content) use ($normalized): ?string {
            $current = WgwApiEnvFile::readValue($content, 'APP_URL') ?? '';
            if ($current === $normalized) {
                return null;
            }

            return WgwApiEnvFile::setLine($content, 'APP_URL', $normalized);
        });

        if (! $wrote && WgwApiEnvFile::readPath($envPath, 'APP_URL') !== $normalized) {
            throw new ApiHttpException(409, 'The web server cannot replace packages/api/.env: it needs write access to the folder that holds it. Add this line there by hand: '.$line);
        }

        return $normalized;
    }

    private function installBase(): string
    {
        try {
            $stored = AppSetting::getValue(SettingKeys::BASE_URI, null);
        } catch (\Throwable) {
            $stored = null;
        }
        if (! is_string($stored) || trim($stored) === '') {
            $fromEnv = config('wgw.install.base_uri');
            $stored = is_string($fromEnv) ? $fromEnv : '/';
        }

        return $stored;
    }
}
