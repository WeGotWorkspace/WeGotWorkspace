<?php

declare(strict_types=1);

namespace App\Services\Update;

use App\Exceptions\ApiHttpException;
use App\Services\Installer\EnvFileWriter;
use App\Support\UpdateFeedDefaults;
use App\Support\WgwApiEnvFile;
use App\Support\WgwInstallConfig;

/**
 * Writes WGW_UPDATE_CHANNEL for the Admin web updater (ZIP installs).
 * Docker installs pick the channel on the host with setup.sh.
 */
final class UpdateChannelSettingService
{
    public function __construct(
        private EnvFileWriter $envFiles,
        private WgwInstallConfig $install,
        private UpdateStateStore $store,
    ) {}

    public function save(string $channel): string
    {
        if (! UpdateFeedDefaults::isChannel($channel)) {
            throw new ApiHttpException(422, 'Choose stable, beta, or edge.');
        }
        if ($this->install->installChannel() === 'docker') {
            throw new ApiHttpException(409, 'Docker installs choose the update channel on the host: bash setup.sh upgrade --channel '.$channel);
        }
        if ($this->store->isLocked()) {
            throw new ApiHttpException(409, 'An update is running. Change the channel after it finishes.');
        }

        $envPath = app()->environmentFilePath();
        if (! is_file($envPath) || ! is_writable($envPath)) {
            throw new ApiHttpException(409, 'The environment file is not writable.');
        }

        $this->envFiles->update($envPath, static function (string $content) use ($channel): ?string {
            if ((WgwApiEnvFile::readValue($content, 'WGW_UPDATE_CHANNEL') ?? '') === $channel) {
                return null;
            }
            if (! WgwApiEnvFile::hasKey($content, 'WGW_UPDATE_CHANNEL')) {
                return rtrim($content)."\nWGW_UPDATE_CHANNEL={$channel}\n";
            }

            return WgwApiEnvFile::setLine($content, 'WGW_UPDATE_CHANNEL', $channel, quote: false);
        });
        if (WgwApiEnvFile::readPath($envPath, 'WGW_UPDATE_CHANNEL') !== $channel) {
            throw new ApiHttpException(409, 'The environment file is not writable.');
        }
        config(['wgw.update_channel' => $channel]);

        // The last check came from the previous channel's feed.
        $state = $this->store->read();
        unset($state['latest'], $state['last_checked_at'], $state['last_check_error']);
        $this->store->write($state);

        return $channel;
    }
}
