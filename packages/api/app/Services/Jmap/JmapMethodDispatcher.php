<?php

declare(strict_types=1);

namespace App\Services\Jmap;

use App\Exceptions\ApiHttpException;
use App\Services\Jmap\Methods\AddressBookChangesMethod;
use App\Services\Jmap\Methods\AddressBookGetMethod;
use App\Services\Jmap\Methods\AddressBookSetMethod;
use App\Services\Jmap\Methods\CalendarChangesMethod;
use App\Services\Jmap\Methods\CalendarEventChangesMethod;
use App\Services\Jmap\Methods\CalendarEventGetMethod;
use App\Services\Jmap\Methods\CalendarEventQueryChangesMethod;
use App\Services\Jmap\Methods\CalendarEventQueryMethod;
use App\Services\Jmap\Methods\CalendarEventSetMethod;
use App\Services\Jmap\Methods\CalendarGetMethod;
use App\Services\Jmap\Methods\CalendarSetMethod;
use App\Services\Jmap\Methods\ContactCardChangesMethod;
use App\Services\Jmap\Methods\ContactCardGetMethod;
use App\Services\Jmap\Methods\ContactCardQueryChangesMethod;
use App\Services\Jmap\Methods\ContactCardQueryMethod;
use App\Services\Jmap\Methods\ContactCardSetMethod;
use App\Services\Jmap\Methods\CoreEchoMethod;
use App\Services\Jmap\Methods\FileNodeChangesMethod;
use App\Services\Jmap\Methods\FileNodeCopyMethod;
use App\Services\Jmap\Methods\FileNodeGetMethod;
use App\Services\Jmap\Methods\FileNodeQueryChangesMethod;
use App\Services\Jmap\Methods\FileNodeQueryMethod;
use App\Services\Jmap\Methods\FileNodeSetMethod;
use App\Services\Jmap\Methods\JmapMethodInterface;

/**
 * JMAP method dispatcher (RFC 8620 §3.2–3.7): processes methodCalls in
 * order, resolves ResultReferences against earlier responses, validates
 * accountId against the authenticated principal, and maps every failure to
 * a method-level `error` invocation — the batch itself always succeeds.
 */
final class JmapMethodDispatcher
{
    /**
     * Registered method handlers per domain; new envelope domains append
     * their classes here (multidomain spec constraint 3: a class list beats
     * a 17-parameter constructor).
     *
     * @var list<class-string<JmapMethodInterface>>
     */
    public const METHODS = [
        CoreEchoMethod::class,
        // urn:ietf:params:jmap:calendars
        CalendarGetMethod::class,
        CalendarChangesMethod::class,
        CalendarSetMethod::class,
        CalendarEventGetMethod::class,
        CalendarEventChangesMethod::class,
        CalendarEventSetMethod::class,
        CalendarEventQueryMethod::class,
        CalendarEventQueryChangesMethod::class,
        // urn:ietf:params:jmap:contacts (RFC 9610)
        AddressBookGetMethod::class,
        AddressBookChangesMethod::class,
        AddressBookSetMethod::class,
        ContactCardGetMethod::class,
        ContactCardChangesMethod::class,
        ContactCardSetMethod::class,
        ContactCardQueryMethod::class,
        ContactCardQueryChangesMethod::class,
        // urn:ietf:params:jmap:filenode (draft-ietf-jmap-filenode-14)
        FileNodeGetMethod::class,
        FileNodeChangesMethod::class,
        FileNodeSetMethod::class,
        FileNodeCopyMethod::class,
        FileNodeQueryMethod::class,
        FileNodeQueryChangesMethod::class,
    ];

    /** @var array<string, JmapMethodInterface> */
    private array $methods = [];

    /**
     * Resolved from self::METHODS by the container binding in
     * WgwServiceProvider — autowiring cannot construct a handler list.
     *
     * @param  list<JmapMethodInterface>  $methods
     */
    public function __construct(array $methods)
    {
        foreach ($methods as $method) {
            $this->register($method);
        }
    }

    private function register(JmapMethodInterface $method): void
    {
        $this->methods[$method->name()] = $method;
    }

    /**
     * Capability URNs with at least one registered method. The supported
     * `using` set is derived from this (via JmapCapabilitySet), so route
     * wiring and capability advertisement cannot drift apart.
     *
     * @return list<string>
     */
    public function capabilityUrns(): array
    {
        $urns = [];
        foreach ($this->methods as $method) {
            $urns[$method->capability()] = true;
        }

        return array_keys($urns);
    }

    /**
     * @param  list<string>  $using
     * @param  list<array{0: string, 1: array<string, mixed>, 2: string}>  $methodCalls
     * @return list<array{0: string, 1: array<string, mixed>, 2: string}>
     */
    public function dispatch(string $username, array $using, array $methodCalls): array
    {
        $responses = [];

        foreach ($methodCalls as [$name, $args, $callId]) {
            try {
                $args = $this->resolveResultReferences($args, $responses);
            } catch (JmapMethodException $e) {
                $responses[] = ['error', $e->errorArgs(), $callId];

                continue;
            }

            $method = $this->methods[$name] ?? null;
            if ($method === null || ! in_array($method->capability(), $using, true)) {
                $responses[] = ['error', ['type' => 'unknownMethod'], $callId];

                continue;
            }

            if ($method->requiresAccountId()) {
                $accountId = $args['accountId'] ?? null;
                if (! is_string($accountId) || $accountId === '') {
                    $responses[] = ['error', ['type' => 'invalidArguments', 'description' => 'accountId is required.'], $callId];

                    continue;
                }
                if ($accountId !== $username) {
                    $responses[] = ['error', ['type' => 'accountNotFound'], $callId];

                    continue;
                }
            }

            try {
                $responses[] = [$name, $method->handle($username, $args), $callId];
            } catch (JmapMethodException $e) {
                $responses[] = ['error', $e->errorArgs(), $callId];
            } catch (ApiHttpException $e) {
                $responses[] = ['error', $this->mapApiException($e), $callId];
            } catch (\Throwable $e) {
                $responses[] = ['error', JmapSetErrors::serverFail($e), $callId];
            }
        }

        return $responses;
    }

    /**
     * ResultReference resolution (RFC 8620 §3.7): every `#key` argument is
     * replaced by evaluating its JSON Pointer (RFC 6901 plus the `*`
     * array-mapping extension) against the matching earlier response.
     *
     * @param  array<string, mixed>  $args
     * @param  list<array{0: string, 1: array<string, mixed>, 2: string}>  $responses
     * @return array<string, mixed>
     */
    private function resolveResultReferences(array $args, array $responses): array
    {
        foreach (array_keys($args) as $key) {
            if (! is_string($key) || ! str_starts_with($key, '#')) {
                continue;
            }

            $plainKey = substr($key, 1);
            if (array_key_exists($plainKey, $args)) {
                // §3.7: an argument present in both normal and referenced form.
                throw new JmapMethodException('invalidArguments', sprintf('Both "%s" and "%s" are present.', $plainKey, $key));
            }

            $reference = $args[$key];
            if (! is_array($reference)
                || ! is_string($reference['resultOf'] ?? null)
                || ! is_string($reference['name'] ?? null)
                || ! is_string($reference['path'] ?? null)) {
                throw new JmapMethodException('invalidResultReference', 'Malformed ResultReference object.');
            }

            $matched = null;
            foreach ($responses as [$responseName, $responseArgs, $responseCallId]) {
                if ($responseCallId === $reference['resultOf'] && $responseName === $reference['name']) {
                    $matched = $responseArgs;
                    break;
                }
            }
            if ($matched === null) {
                throw new JmapMethodException('invalidResultReference', 'No matching prior method response.');
            }

            try {
                $args[$plainKey] = $this->evaluatePointer($matched, $reference['path']);
            } catch (\OutOfBoundsException $e) {
                throw new JmapMethodException('invalidResultReference', $e->getMessage());
            }
            unset($args[$key]);
        }

        return $args;
    }

    /**
     * RFC 6901 JSON Pointer evaluation with the RFC 8620 §3.7 `*` extension
     * (map the remainder of the pointer over an array, flattening one level).
     */
    private function evaluatePointer(mixed $value, string $pointer): mixed
    {
        if ($pointer === '') {
            return $value;
        }
        if (! str_starts_with($pointer, '/')) {
            throw new \OutOfBoundsException('JSON Pointer must start with "/".');
        }

        $tokens = array_map(
            static fn (string $token): string => str_replace(['~1', '~0'], ['/', '~'], $token),
            explode('/', substr($pointer, 1)),
        );

        return $this->evaluateTokens($value, $tokens);
    }

    /**
     * @param  list<string>  $tokens
     */
    private function evaluateTokens(mixed $value, array $tokens): mixed
    {
        if ($tokens === []) {
            return $value;
        }

        $token = array_shift($tokens);

        if (is_array($value) && array_is_list($value)) {
            if ($token === '*') {
                $result = [];
                foreach ($value as $item) {
                    $resolved = $this->evaluateTokens($item, $tokens);
                    if (is_array($resolved) && array_is_list($resolved)) {
                        foreach ($resolved as $entry) {
                            $result[] = $entry;
                        }
                    } else {
                        $result[] = $resolved;
                    }
                }

                return $result;
            }
            if (! ctype_digit($token) || (int) $token >= count($value)) {
                throw new \OutOfBoundsException(sprintf('Pointer token "%s" does not resolve.', $token));
            }

            return $this->evaluateTokens($value[(int) $token], $tokens);
        }

        if (is_array($value) && array_key_exists($token, $value)) {
            return $this->evaluateTokens($value[$token], $tokens);
        }

        throw new \OutOfBoundsException(sprintf('Pointer token "%s" does not resolve.', $token));
    }

    /**
     * Maps service-layer HTTP exceptions to the RFC 8620 §3.6.2 method-error
     * vocabulary (spec §7): recognized codes pass through, everything else
     * degrades by HTTP status.
     *
     * @return array<string, mixed>
     */
    private function mapApiException(ApiHttpException $e): array
    {
        $type = match ($e->errorCode()) {
            'cannotCalculateChanges' => 'cannotCalculateChanges',
            'stateMismatch' => 'stateMismatch',
            'forbidden' => 'forbidden',
            default => match (true) {
                $e->getStatusCode() === 403 => 'forbidden',
                $e->getStatusCode() >= 400 && $e->getStatusCode() < 500 => 'invalidArguments',
                default => 'serverFail',
            },
        };

        return ['type' => $type, 'description' => $e->getMessage()];
    }
}
