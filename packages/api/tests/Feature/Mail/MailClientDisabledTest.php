<?php

declare(strict_types=1);

namespace Tests\Feature\Mail;

use Tests\TestCase;

/**
 * Default boot. Flag-on coverage lives on the other Mail* tests via WithMailClientEnabled.
 * A 404 here is the shipped contract. A 404 on those tests means the env never reached
 * route registration (including config:cache / route:cache).
 */
final class MailClientDisabledTest extends TestCase
{
    public function test_mailbox_routes_are_not_registered(): void
    {
        $this->getJson('/api/v1/mail/status')->assertNotFound();
        $this->getJson('/api/v1/mail/folders')->assertNotFound();
        $this->getJson('/api/v1/mail/messages')->assertNotFound();
    }
}
