<?php

declare(strict_types=1);

namespace App\Http\Controllers\Api\V1\Jmap;

use App\Http\Middleware\AuthenticateWgwApi;
use App\Services\Jmap\JmapCapabilities;
use App\Services\Jmap\JmapMethodDispatcher;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * JMAP batch API endpoint (RFC 8620 §3).
 *
 * Always returns HTTP 200 for structurally valid batches — individual method
 * failures travel as `error` invocations inside methodResponses. Non-2xx is
 * reserved for request-level errors (§3.6.1): malformed JSON, a body that is
 * not a Request object, unsupported capabilities, and size limits.
 */
final class JmapApiController
{
    public function __construct(private readonly JmapMethodDispatcher $dispatcher) {}

    public function handle(Request $request): JsonResponse
    {
        $content = $request->getContent();
        if (strlen($content) > JmapCapabilities::coreCapability()['maxSizeRequest']) {
            return $this->limitProblem('maxSizeRequest', 'Request body exceeds maxSizeRequest.');
        }

        $body = json_decode($content, true);
        if (! is_array($body)) {
            return $this->problem('urn:ietf:params:jmap:error:notJSON', 400, 'Request body is not valid JSON.');
        }

        $using = $body['using'] ?? null;
        if (! is_array($using) || $using === [] || ! array_is_list($using)) {
            return $this->problem('urn:ietf:params:jmap:error:notRequest', 400, 'using must be a non-empty array of capability URIs.');
        }
        $supported = [JmapCapabilities::CORE, JmapCapabilities::CALENDARS];
        foreach ($using as $capability) {
            if (! is_string($capability) || ! in_array($capability, $supported, true)) {
                return $this->problem('urn:ietf:params:jmap:error:unknownCapability', 400, sprintf('Unsupported capability: %s.', is_string($capability) ? $capability : gettype($capability)));
            }
        }

        $methodCalls = $body['methodCalls'] ?? null;
        if (! is_array($methodCalls) || ! array_is_list($methodCalls)) {
            return $this->problem('urn:ietf:params:jmap:error:notRequest', 400, 'methodCalls must be an array of method invocations.');
        }
        if (count($methodCalls) > JmapCapabilities::MAX_CALLS_IN_REQUEST) {
            return $this->limitProblem('maxCallsInRequest', 'Too many method calls in one request.');
        }
        foreach ($methodCalls as $invocation) {
            if (! $this->isInvocation($invocation)) {
                return $this->problem('urn:ietf:params:jmap:error:notRequest', 400, 'Each method call must be a [name, arguments, callId] triple.');
            }
        }

        $principal = $request->attributes->get(AuthenticateWgwApi::PRINCIPAL_ATTRIBUTE);
        $responses = $this->dispatcher->dispatch((string) $principal['username'], $using, $methodCalls);

        return response()->json([
            'methodResponses' => $responses,
            'sessionState' => JmapCapabilities::SESSION_STATE,
        ]);
    }

    private function isInvocation(mixed $invocation): bool
    {
        if (! is_array($invocation) || ! array_is_list($invocation) || count($invocation) !== 3) {
            return false;
        }
        [$name, $args, $callId] = $invocation;

        return is_string($name) && $name !== ''
            && is_array($args) && ($args === [] || ! array_is_list($args))
            && is_string($callId);
    }

    private function problem(string $type, int $status, string $detail, array $extra = []): JsonResponse
    {
        return response()
            ->json(array_merge(['type' => $type, 'status' => $status, 'detail' => $detail], $extra), $status)
            ->header('Content-Type', 'application/problem+json');
    }

    private function limitProblem(string $limit, string $detail): JsonResponse
    {
        return $this->problem('urn:ietf:params:jmap:error:limit', 400, $detail, ['limit' => $limit]);
    }
}
