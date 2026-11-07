<?php

declare(strict_types=1);

namespace Tests\Unit\Notify;

use App\Services\Notify\NotifiedRecipients;
use PHPUnit\Framework\TestCase;

/** Who a request's writes notified, named only to the actor (#1662). */
final class NotifiedRecipientsTest extends TestCase
{
    public function test_names_only_principals_notified_by_that_actor(): void
    {
        $recipients = new NotifiedRecipients;
        $recipients->record('Bob', 'carol');
        $recipients->record('bob', 'Alice');
        $recipients->record('bob', 'alice');
        $recipients->record('system', 'dave');

        $this->assertSame(['alice', 'carol'], $recipients->notifiedBy('BOB'));
        $this->assertSame([], $recipients->notifiedBy('carol'));
    }

    public function test_never_names_the_actor_and_drops_unsafe_names(): void
    {
        $recipients = new NotifiedRecipients;
        $recipients->record('bob', 'bob');
        $recipients->record('bob', '');
        $recipients->record('bob', 'a,b');
        $recipients->record('bob', 'two words');
        $recipients->record('bob', "line\nbreak");

        $this->assertSame([], $recipients->notifiedBy('bob'));
    }

    public function test_caps_the_list_and_resets(): void
    {
        $recipients = new NotifiedRecipients;
        for ($i = 0; $i < NotifiedRecipients::MAX_HEADER_NAMES + 10; $i++) {
            $recipients->record('bob', sprintf('user%03d', $i));
        }
        $this->assertCount(NotifiedRecipients::MAX_HEADER_NAMES, $recipients->notifiedBy('bob'));

        $recipients->reset();
        $this->assertSame([], $recipients->notifiedBy('bob'));
    }
}
