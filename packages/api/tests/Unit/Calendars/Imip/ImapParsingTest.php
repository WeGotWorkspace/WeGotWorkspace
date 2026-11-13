<?php

declare(strict_types=1);

namespace Tests\Unit\Calendars\Imip;

use App\Services\Calendars\Imip\ImapBodyStructure;
use App\Services\Calendars\Imip\ImapException;
use App\Services\Calendars\Imip\ImapResponseParser;
use App\Services\Calendars\Imip\MimePartDecoder;
use PHPUnit\Framework\TestCase;

final class ImapParsingTest extends TestCase
{
    public function test_parses_lists_strings_literals_and_sections(): void
    {
        $raw = "1 FETCH (UID 7 RFC822.SIZE 120 BODY[HEADER.FIELDS (FROM)] {11}\r\nFrom: a@b\r\n FLAGS (\\Seen) X \"q\\\"s\" NIL)";

        $parsed = ImapResponseParser::parse($raw);

        $this->assertSame('1', $parsed[0]);
        $this->assertSame(['UID', '7', 'RFC822.SIZE', '120', 'BODY[HEADER.FIELDS (FROM)]', "From: a@b\r\n", 'FLAGS', ['\\Seen'], 'X', 'q"s', null], $parsed[2]);
    }

    public function test_rejects_unbalanced_and_truncated_input(): void
    {
        foreach (['(A (B)', 'A)', '{50}'."\r\n".'short', '"open'] as $raw) {
            try {
                ImapResponseParser::parse($raw);
                $this->fail('expected a protocol error for '.$raw);
            } catch (ImapException $exception) {
                $this->assertSame(ImapException::PROTOCOL_ERROR, $exception->errorCode);
            }
        }
    }

    public function test_rejects_deep_nesting(): void
    {
        $this->expectException(ImapException::class);

        ImapResponseParser::parse(str_repeat('(', 100).str_repeat(')', 100));
    }

    public function test_finds_the_calendar_part_in_a_nested_multipart(): void
    {
        $structure = ImapResponseParser::parse(
            '((("TEXT" "PLAIN" ("CHARSET" "UTF-8") NIL NIL "7BIT" 40 2 NIL NIL NIL NIL)'
            .'("TEXT" "CALENDAR" ("CHARSET" "ISO-8859-1" "METHOD" "REPLY") NIL NIL "QUOTED-PRINTABLE" 512 8 NIL NIL NIL NIL)'
            .' "ALTERNATIVE" ("BOUNDARY" "b2") NIL NIL NIL) "MIXED" ("BOUNDARY" "b1") NIL NIL NIL)',
        );

        $part = ImapBodyStructure::calendarPart($structure[0]);

        $this->assertNotNull($part);
        $this->assertSame('1.2', $part->section);
        $this->assertSame('quoted-printable', $part->encoding);
        $this->assertSame('iso-8859-1', $part->charset);
        $this->assertSame('REPLY', $part->method);
        $this->assertSame(512, $part->size);
    }

    public function test_single_part_calendar_is_section_one(): void
    {
        $structure = ImapResponseParser::parse('("TEXT" "CALENDAR" ("METHOD" "REPLY") NIL NIL "7BIT" 300 9 NIL NIL NIL NIL)');

        $this->assertSame('1', ImapBodyStructure::calendarPart($structure[0])?->section);
    }

    public function test_calendar_inside_an_attached_message_is_ignored(): void
    {
        $structure = ImapResponseParser::parse(
            '(("TEXT" "PLAIN" NIL NIL NIL "7BIT" 10 1 NIL NIL NIL NIL)'
            .'("MESSAGE" "RFC822" NIL NIL NIL "7BIT" 900 ("date" "subj" NIL NIL NIL NIL NIL NIL NIL "<id>")'
            .' ("TEXT" "CALENDAR" ("METHOD" "REPLY") NIL NIL "7BIT" 300 9 NIL NIL NIL NIL) 20 NIL NIL NIL NIL)'
            .' "MIXED" ("BOUNDARY" "b") NIL NIL NIL)',
        );

        $this->assertNull(ImapBodyStructure::calendarPart($structure[0]));
    }

    public function test_decodes_transfer_encodings_and_charsets(): void
    {
        $this->assertSame("SUMMARY:Caf\u{e9}", MimePartDecoder::decode(chunk_split(base64_encode("SUMMARY:Caf\u{e9}"), 4), 'base64', 'utf-8'));
        $this->assertSame("SUMMARY:Caf\u{e9}", MimePartDecoder::decode('SUMMARY:Caf=E9', 'quoted-printable', 'iso-8859-1'));
        $this->assertNull(MimePartDecoder::decode("\xff\xfe", '8bit', 'utf-8'));
        $this->assertNull(MimePartDecoder::decode('x', 'x-uuencode', 'utf-8'));
        $this->assertNull(MimePartDecoder::decode('x', '7bit', 'x-made-up'));
    }
}
