<?php

declare(strict_types=1);

namespace Tests\Feature\Teams;

use Illuminate\Testing\TestResponse;

/**
 * Existence-oracle check for Epic #1915: a write refused because the target shares no Team
 * with the caller answers exactly like the same write to a name that does not exist.
 */
trait RefusedLikeUnknown
{
    /**
     * @param  callable(string, string): TestResponse  $attempt  ($caller, $target)
     */
    private function assertRefusedLikeUnknown(callable $attempt, string $caller, string $refused, string $unknown): void
    {
        $refusedResponse = $attempt($caller, $refused);
        $unknownResponse = $attempt($caller, $unknown);

        $unknownBody = $this->refusalBody($unknownResponse);
        $this->assertNotSame([], $unknownBody, 'The write to an unknown name must fail.');
        $this->assertSame($unknownResponse->getStatusCode(), $refusedResponse->getStatusCode());
        $this->assertSame(
            $this->withoutName($unknownBody, $unknown),
            $this->withoutName($this->refusalBody($refusedResponse), $refused),
        );
    }

    /**
     * The JMAP `notUpdated`/`notCreated` errors of a 200 envelope, or the error body.
     *
     * @return array<mixed>
     */
    private function refusalBody(TestResponse $response): array
    {
        $methodResponses = $response->json('methodResponses');
        if (! is_array($methodResponses)) {
            return $response->getStatusCode() >= 400 ? (array) $response->json() : [];
        }
        $errors = [];
        foreach ($methodResponses as $call) {
            foreach (['notCreated', 'notUpdated'] as $key) {
                if (is_array($call[1][$key] ?? null) && $call[1][$key] !== []) {
                    $errors[] = $call[1][$key];
                }
            }
        }

        return $errors;
    }

    /**
     * @param  array<mixed>  $body
     * @return array<mixed>
     */
    private function withoutName(array $body, string $name): array
    {
        $json = str_replace($name, '<name>', (string) json_encode($body, JSON_UNESCAPED_SLASHES));

        return (array) json_decode($json, true);
    }
}
