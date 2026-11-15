<?php

declare(strict_types=1);

namespace Tests\Unit\Calendars\Imip;

use App\Services\Calendars\Imip\ImapClient;
use App\Services\Calendars\Imip\ImapEndpoint;
use App\Services\Calendars\Imip\ImapException;
use PHPUnit\Framework\TestCase;
use Tests\Support\FakeImapServer;

final class ImapClientTest extends TestCase
{
    public function test_starttls_login_examine_and_search(): void
    {
        $server = new FakeImapServer(messages: [3 => $this->message(), 9 => $this->message()], uidValidity: 42);
        $client = new ImapClient($server);

        $client->connect($this->endpoint(ImapEndpoint::SECURITY_STARTTLS), 'organizer@example.test', 'secret');
        $state = $client->examine('INBOX');

        $this->assertTrue($server->tls);
        $this->assertSame(['uidvalidity' => 42, 'uidnext' => 10, 'exists' => 2], $state);
        $this->assertSame(9, $client->highestUid($state['exists'], $state['uidnext']));
        $this->assertSame([9], $client->uidsAfter(3));
        $this->assertSame([], $client->uidsAfter(9));
        $this->assertSame(['STARTTLS', 'LOGIN "organizer@example.test" "***"', 'EXAMINE "INBOX"', 'UID SEARCH UID 4:*', 'UID SEARCH UID 10:*'], $server->verbs());
    }

    public function test_highest_uid_without_uidnext(): void
    {
        $server = new FakeImapServer(messages: [5 => $this->message()], sendUidNext: false);
        $client = new ImapClient($server);
        $client->connect($this->endpoint(), 'organizer@example.test', 'secret');
        $state = $client->examine('INBOX');

        $this->assertSame(5, $client->highestUid($state['exists'], $state['uidnext']));
    }

    public function test_password_with_quotes_and_non_ascii_logs_in(): void
    {
        $password = "p\"a\\ss w\u{f6}rd";
        $server = new FakeImapServer(password: $password);
        $client = new ImapClient($server);

        $client->connect($this->endpoint(), 'organizer@example.test', $password);
        $client->examine('INBOX');

        $this->assertSame(['LOGIN "organizer@example.test" "***"', 'EXAMINE "INBOX"'], $server->verbs());
    }

    public function test_wrong_password_and_missing_folder_have_their_codes(): void
    {
        $client = new ImapClient(new FakeImapServer);
        try {
            $client->connect($this->endpoint(), 'organizer@example.test', 'wrong');
            $this->fail('login should fail');
        } catch (ImapException $exception) {
            $this->assertSame(ImapException::AUTH_FAILED, $exception->errorCode);
        }

        $client = new ImapClient(new FakeImapServer);
        $client->connect($this->endpoint(), 'organizer@example.test', 'secret');
        try {
            $client->examine('Nope');
            $this->fail('examine should fail');
        } catch (ImapException $exception) {
            $this->assertSame(ImapException::FOLDER_MISSING, $exception->errorCode);
        }
    }

    public function test_values_with_line_breaks_are_refused(): void
    {
        $this->expectException(ImapException::class);

        (new ImapClient(new FakeImapServer))->connect($this->endpoint(), "organizer\r\nW9 DELETE INBOX", 'secret');
    }

    public function test_summaries_and_section(): void
    {
        $server = new FakeImapServer(messages: [7 => $this->message()]);
        $client = new ImapClient($server);
        $client->connect($this->endpoint(), 'organizer@example.test', 'secret');
        $client->examine('INBOX');

        $summary = $client->summaries([7])[7];

        $this->assertSame(1234, $summary->size);
        $this->assertSame('a@example.com', $summary->headers->first('from'));
        $this->assertSame('1', $summary->calendarPart?->section);
        $this->assertSame("BEGIN:VCALENDAR\r\n", $client->section(7, '1'));
        $this->assertStringContainsString('BODY.PEEK[HEADER.FIELDS (FROM SENDER MESSAGE-ID AUTHENTICATION-RESULTS)]', $server->verbs()[2]);
    }

    private function endpoint(string $security = ImapEndpoint::SECURITY_SSL): ImapEndpoint
    {
        return new ImapEndpoint('imap.example.test', '192.0.2.1', 993, $security);
    }

    /** @return array{size: int, headers: string, structure: string, sections: array<string, string>} */
    private function message(): array
    {
        return [
            'size' => 1234,
            'headers' => "From: a@example.com\r\n\r\n",
            'structure' => '("TEXT" "CALENDAR" ("METHOD" "REPLY") NIL NIL "7BIT" 17 1 NIL NIL NIL NIL)',
            'sections' => ['1' => "BEGIN:VCALENDAR\r\n"],
        ];
    }
}
