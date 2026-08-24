<?php

declare(strict_types=1);

namespace Tests\Feature\Calendars;

use Tests\Support\OpenApiContract;
use Tests\TestCase;

/**
 * Chunk A contract-first stubs for ICS / webcal subscribe + publish (#602 / #603).
 * HTTP behavior is implemented in later chunks; until then these paths 404.
 */
final class CalendarsIcsWebcalContractTest extends TestCase
{
    public function test_openapi_documents_subscription_and_feed_operations(): void
    {
        $expected = [
            'GET /calendars/subscriptions' => 'user',
            'POST /calendars/subscriptions' => 'user',
            'GET /calendars/subscriptions/{id}' => 'user',
            'DELETE /calendars/subscriptions/{id}' => 'user',
            'POST /calendars/subscriptions/{id}/refresh' => 'user',
            'GET /calendars/{calendarId}/feed' => 'user',
            'POST /calendars/{calendarId}/feed' => 'user',
            'DELETE /calendars/{calendarId}/feed' => 'user',
            'GET /calendars/feeds/{token}' => 'guest',
        ];

        $accessByOperation = [];
        foreach (OpenApiContract::operationsWithAccess() as $operation) {
            $accessByOperation[$operation['method'].' '.$operation['path']] = $operation['access'];
        }

        foreach ($expected as $operation => $access) {
            $this->assertSame(
                $access,
                $accessByOperation[$operation] ?? null,
                "OpenAPI {$operation} must declare x-wgw-access: {$access}"
            );
        }
    }

    public function test_calendar_schema_adds_optional_subscription_id_without_changing_is_subscribed(): void
    {
        $calendar = OpenApiContract::loadSpec()['components']['schemas']['Calendar'] ?? null;
        $this->assertIsArray($calendar);

        $required = $calendar['required'] ?? [];
        $this->assertContains('isSubscribed', $required);
        $this->assertNotContains('subscriptionId', $required);

        $isSubscribed = $calendar['properties']['isSubscribed'] ?? null;
        $this->assertIsArray($isSubscribed);
        $this->assertSame('boolean', $isSubscribed['type'] ?? null);

        $subscriptionId = $calendar['properties']['subscriptionId'] ?? null;
        $this->assertIsArray($subscriptionId);
        $this->assertSame(['string', 'null'], $subscriptionId['type'] ?? null);
    }

    public function test_public_feed_documents_text_calendar(): void
    {
        $get = OpenApiContract::paths()['/calendars/feeds/{token}']['get'] ?? null;
        $this->assertIsArray($get);
        $this->assertArrayHasKey('text/calendar', $get['responses']['200']['content'] ?? []);
        $this->assertSame('guest', $get['x-wgw-access'] ?? null);
    }
}
