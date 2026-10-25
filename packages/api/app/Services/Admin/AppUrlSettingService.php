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

        $envPath = app()->environmentFilePath();
        if (! is_file($envPath) || ! is_writable($envPath)) {
            throw new ApiHttpException(409, 'The environment file is not writable.');
        }

        $wrote = $this->envFiles->update($envPath, static function (string $content) use ($normalized): ?string {
            $current = WgwApiEnvFile::readValue($content, 'APP_URL') ?? '';
            if ($current === $normalized) {
                return null;
            }

            return WgwApiEnvFile::setLine($content, 'APP_URL', $normalized);
        });

        if (! $wrote && WgwApiEnvFile::readPath($envPath, 'APP_URL') !== $normalized) {
            throw new ApiHttpException(409, 'The environment file is not writable.');
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
