<?php

declare(strict_types=1);

namespace App\Http\Controllers\Api\V1\Mail;

use App\Http\Middleware\AuthenticateWgwApi;
use App\Services\Mail\MailOperationService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

final class MailController
{
    public function __construct(private MailOperationService $mail) {}

    public function status(Request $request): JsonResponse
    {
        /** @var array{username: string, role: string} $principal */
        $principal = $request->attributes->get(AuthenticateWgwApi::PRINCIPAL_ATTRIBUTE);

        return response()->json($this->mail->status($principal['username']));
    }
}
