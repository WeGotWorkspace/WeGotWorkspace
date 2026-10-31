<?php

declare(strict_types=1);

namespace Tests\Feature\System;

use Tests\TestCase;

/**
 * The mailbox client was removed (#1573). Platform mail delivery stays;
 * its coverage lives in tests/Feature/MailDelivery and AdminMailDeliveryTest.
 */
final class MailClientRoutesRemovedTest extends TestCase
{
    public function test_mailbox_routes_are_not_registered(): void
    {
        $this->getJson('/api/v1/mail/status')->assertNotFound();
        $this->getJson('/api/v1/mail/folders')->assertNotFound();
        $this->getJson('/api/v1/mail/messages')->assertNotFound();
        $this->putJson('/api/v1/settings/mail', [])->assertNotFound();
    }
}
