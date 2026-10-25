<?php

declare(strict_types=1);

namespace App\Services\Update;

final class UpdateOperationsService
{
    public function __construct(
        private UpdateRunner $runner,
        private UpdateChannelSettingService $channels,
    ) {}

    /**
     * @return array<string, mixed>
     */
    public function check(): array
    {
        return $this->runner->check($this->channels->feedUrl());
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
}
