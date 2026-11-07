<?php

declare(strict_types=1);

namespace App\Http\Middleware;

use App\Services\Notify\NotifiedRecipients;
use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

/**
 * Names the users the caller's own writes notified in `X-Wgw-Notified` (#1662).
 * Only names from events whose actor is the authenticated user, and only on a
 * successful response; the header is never set on a read that notified no one.
 */
final class ExposeNotifiedRecipients
{
    public function __construct(private NotifiedRecipients $recipients) {}

    /**
     * @param  Closure(Request): Response  $next
     */
    public function handle(Request $request, Closure $next): Response
    {
        $this->recipients->reset();
        $response = $next($request);
        if (! $response->isSuccessful()) {
            return $response;
        }
        $principal = $request->attributes->get(AuthenticateWgwApi::PRINCIPAL_ATTRIBUTE);
        $username = is_array($principal) ? (string) ($principal['username'] ?? '') : '';
        if ($username === '') {
            return $response;
        }
        $names = $this->recipients->notifiedBy($username);
        if ($names !== []) {
            $response->headers->set(NotifiedRecipients::HEADER, implode(',', $names));
        }

        return $response;
    }
}
