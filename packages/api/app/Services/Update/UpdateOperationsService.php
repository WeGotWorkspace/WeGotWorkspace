<?php

declare(strict_types=1);

namespace App\Services\Update;

use App\Support\UpdateFeedDefaults;

final class UpdateOperationsService
{
    public function __construct(
        private UpdateRunner $runner,
    ) {}

    /**
     * @return array<string, mixed>
     */
    public function check(): array
    {
        return $this->runner->check($this->updateFeedUrl());
    }

    /**
     * @param  array<string, mixed>  $input
     * @return array<string, mixed>
     */
    public function apply(array $input): array
    {
        return $this->runner->apply($input);
    }

    /**
     * @return array<string, mixed>
     */
    public function cancel(): array
    {
        return $this->runner->cancel();
    }

    private function updateFeedUrl(): string
    {
        $fromConfig = config('wgw.update_feed_url');

        return is_string($fromConfig) && trim($fromConfig) !== ''
            ? trim($fromConfig)
            : UpdateFeedDefaults::MANIFEST_URL;
    }
}
