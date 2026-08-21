<?php

declare(strict_types=1);

namespace App\Services\System;

use App\Services\MailDelivery\MailDeliveryService;
use App\Support\ApiUrlBuilder;

final class CapabilitiesService
{
    public function __construct(
        private ApiUrlBuilder $urls,
        private MailDeliveryService $mailDelivery,
    ) {}

    /**
     * @return array{
     *   apiVersion: string,
     *   auth: array{type: string, tokenEndpoint: string, refreshEndpoint: string, revokeEndpoint: string, jwksEndpoint: string, passwordRecovery: bool},
     *   domains: list<array{name: string, requiredRole: string}>
     * }
     */
    public function snapshot(): array
    {
        return [
            'apiVersion' => 'v1',
            'auth' => [
                'type' => 'bearer-jwt-rs256',
                'tokenEndpoint' => $this->urls->v1('auth/token'),
                'refreshEndpoint' => $this->urls->v1('auth/refresh'),
                'revokeEndpoint' => $this->urls->v1('auth/revoke'),
                'jwksEndpoint' => $this->urls->v1('.well-known/jwks.json'),
                'passwordRecovery' => $this->passwordRecoveryEnabled(),
            ],
            'domains' => $this->domains(),
        ];
    }

    private function passwordRecoveryEnabled(): bool
    {
        try {
            return (bool) ($this->mailDelivery->adminState()['capability']['canSubmit'] ?? false);
        } catch (\Throwable) {
            return false;
        }
    }

    /**
     * @return list<array{name: string, requiredRole: string}>
     */
    private function domains(): array
    {
        $map = [
            'admin' => 'admin',
            'settings' => 'user',
            'mail' => 'user',
            'drive' => 'user',
            'notes' => 'user',
            'plugins' => 'user',
            'meet' => 'guest',
            'installer' => 'guest',
            'home' => 'guest',
            'dav' => 'user',
        ];
        $out = [];
        foreach ($map as $name => $requiredRole) {
            $out[] = ['name' => $name, 'requiredRole' => $requiredRole];
        }

        return $out;
    }
}
