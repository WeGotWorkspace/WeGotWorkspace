<?php

declare(strict_types=1);

namespace App\Http\Controllers\Api\V1\Jmap;

use App\Http\Middleware\AuthenticateWgwApi;
use App\Services\Jmap\JmapCapabilities;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * JMAP Session resource (RFC 8620 §2).
 *
 * One account per authenticated principal; accountId is the raw username
 * (usernames are a strict subset of the JMAP Id charset — spec §1). All URLs
 * are absolute because the client fetches apiUrl verbatim with no base-URL
 * resolution (spec §2).
 */
final class JmapSessionController
{
    public function __invoke(Request $request): JsonResponse
    {
        $principal = $request->attributes->get(AuthenticateWgwApi::PRINCIPAL_ATTRIBUTE);
        $username = (string) $principal['username'];
        $base = rtrim(url('/api/v1/jmap'), '/');

        return response()->json([
            'capabilities' => [
                JmapCapabilities::CORE => JmapCapabilities::coreCapability(),
                // Session-level calendars capability is the empty object;
                // the six-property object lives in accountCapabilities
                // (draft-ietf-jmap-calendars-27 §1.5.1).
                JmapCapabilities::CALENDARS => (object) [],
            ],
            'accounts' => [
                $username => [
                    'name' => $username,
                    'isPersonal' => true,
                    'isReadOnly' => false,
                    'accountCapabilities' => [
                        JmapCapabilities::CALENDARS => JmapCapabilities::calendarsAccountCapability(),
                    ],
                ],
            ],
            'primaryAccounts' => [
                JmapCapabilities::CORE => $username,
                JmapCapabilities::CALENDARS => $username,
            ],
            'username' => $username,
            'apiUrl' => $base,
            'downloadUrl' => $base.'/download/{accountId}/{blobId}/{name}?type={type}',
            'uploadUrl' => $base.'/upload/{accountId}',
            'eventSourceUrl' => $base.'/events/{types}/{closeafter}/{ping}',
            'state' => JmapCapabilities::SESSION_STATE,
        ]);
    }
}
