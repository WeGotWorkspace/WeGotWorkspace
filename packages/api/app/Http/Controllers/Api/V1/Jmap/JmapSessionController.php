<?php

declare(strict_types=1);

namespace App\Http\Controllers\Api\V1\Jmap;

use App\Http\Middleware\AuthenticateWgwApi;
use App\Services\Jmap\Capabilities\JmapCapabilitySet;
use App\Services\Jmap\Guest\GuestJmapGateway;
use App\Services\Jmap\Guest\GuestUploadGate;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * JMAP Session resource (RFC 8620 §2).
 *
 * One account per authenticated principal; accountId is the raw username
 * (usernames are a strict subset of the JMAP Id charset — spec §1). All URLs
 * are absolute because the client fetches apiUrl verbatim with no base-URL
 * resolution (spec §2). Capabilities, primaryAccounts, and the session state
 * are derived per domain from JmapCapabilitySet — feature-gated-off domains
 * are simply absent.
 *
 * A guest gets the Session of its guest upload account (#1715), or 403 when
 * its share link does not allow uploads.
 */
final class JmapSessionController
{
    public function __construct(
        private readonly JmapCapabilitySet $capabilities,
        private readonly GuestJmapGateway $guest,
        private readonly GuestUploadGate $guestGate,
    ) {}

    public function __invoke(Request $request): JsonResponse
    {
        $principal = $request->attributes->get(AuthenticateWgwApi::PRINCIPAL_ATTRIBUTE);
        if ((string) $principal['role'] === 'guest') {
            return response()->json($this->guest->session($this->guestGate->open($principal)));
        }
        $username = (string) $principal['username'];
        $base = rtrim(url('/api/v1/jmap'), '/');

        return response()->json([
            'capabilities' => $this->capabilities->sessionCapabilities(),
            'accounts' => [
                $username => [
                    'name' => $username,
                    'isPersonal' => true,
                    'isReadOnly' => false,
                    'accountCapabilities' => $this->capabilities->accountCapabilities(),
                ],
            ],
            'primaryAccounts' => $this->capabilities->primaryAccounts($username),
            'username' => $username,
            'apiUrl' => $base,
            'downloadUrl' => $base.'/download/{accountId}/{blobId}/{name}?type={type}',
            'uploadUrl' => $base.'/upload/{accountId}',
            'eventSourceUrl' => $base.'/events/{types}/{closeafter}/{ping}',
            'state' => $this->capabilities->sessionState(),
        ]);
    }
}
