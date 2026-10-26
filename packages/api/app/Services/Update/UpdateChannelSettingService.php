<?php

declare(strict_types=1);

namespace App\Services\Update;

use App\Exceptions\ApiHttpException;
use App\Models\AppSetting;
use App\Services\Settings\SettingKeys;
use App\Support\UpdateFeedDefaults;
use App\Support\WgwInstallConfig;
use Illuminate\Database\QueryException;

/**
 * The release channel the Admin web updater follows.
 *
 * ZIP installs store the admin's choice in app_settings; until then the
 * WGW_UPDATE_CHANNEL env value applies. Docker installs pick the channel on
 * the host with setup.sh, so they only ever read the env value.
 */
final class UpdateChannelSettingService
{
    public function __construct(
        private WgwInstallConfig $install,
        private UpdateStateStore $store,
    ) {}

    public function current(): string
    {
        $fromEnv = UpdateFeedDefaults::normalizeChannel(config('wgw.update_channel'));
        if ($this->isDocker()) {
            return $fromEnv;
        }

        try {
            $stored = AppSetting::getValue(SettingKeys::UPDATE_CHANNEL);
        } catch (QueryException) {
            // Update status must still render while the database is being restored.
            $stored = null;
        }

        return is_string($stored) && UpdateFeedDefaults::isChannel($stored) ? $stored : $fromEnv;
    }

    public function feedUrl(): string
    {
        return UpdateFeedDefaults::feedUrl(config('wgw.update_feed_url'), $this->current());
    }

    public function save(string $channel): string
    {
        if (! UpdateFeedDefaults::isChannel($channel)) {
            throw new ApiHttpException(422, 'Choose stable, beta, or edge.');
        }
        if ($this->isDocker()) {
            throw new ApiHttpException(409, 'Docker installs choose the update channel on the host: bash setup.sh upgrade --channel '.$channel);
        }
        if ($this->store->isLocked()) {
            throw new ApiHttpException(409, 'An update is running. Change the channel after it finishes.');
        }

        AppSetting::setValue(SettingKeys::UPDATE_CHANNEL, $channel);

        // The last check came from the previous channel's feed.
        $state = $this->store->read();
        unset($state['latest'], $state['last_checked_at'], $state['last_check_error']);
        $this->store->write($state);

        return $channel;
    }

    private function isDocker(): bool
    {
        return $this->install->installChannel() === 'docker';
    }
}
