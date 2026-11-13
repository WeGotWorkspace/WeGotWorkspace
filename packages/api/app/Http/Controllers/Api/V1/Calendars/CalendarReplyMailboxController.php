<?php

declare(strict_types=1);

namespace App\Http\Controllers\Api\V1\Calendars;

use App\Http\Middleware\AuthenticateWgwApi;
use App\Services\Calendars\Imip\ImipMailboxPayload;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Response;

/** The mailbox the caller's invitation replies are read from (#1589). */
final class CalendarReplyMailboxController
{
    public function __construct(private readonly ImipMailboxPayload $mailbox) {}

    public function show(Request $request): JsonResponse
    {
        return response()->json($this->mailbox->show($this->username($request)));
    }

    public function update(Request $request): JsonResponse
    {
        $payload = json_decode((string) $request->getContent(), true);

        return response()->json($this->mailbox->update($this->username($request), $payload));
    }

    public function test(Request $request): JsonResponse
    {
        return response()->json($this->mailbox->test($this->username($request)));
    }

    public function destroy(Request $request): Response
    {
        $this->mailbox->delete($this->username($request));

        return response()->noContent();
    }

    private function username(Request $request): string
    {
        $principal = $request->attributes->get(AuthenticateWgwApi::PRINCIPAL_ATTRIBUTE);

        return (string) $principal['username'];
    }
}
