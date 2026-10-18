<?php

declare(strict_types=1);

namespace Tests\Unit\VObject;

use App\Services\VObject\VCardInPlacePatcher;
use PHPUnit\Framework\TestCase;

final class VCardInPlacePatcherTest extends TestCase
{
    public function test_changed_entry_keeps_its_stored_group_and_label(): void
    {
        $stored = $this->card("ITEM1.EMAIL;TYPE=INTERNET;PROP-ID=e1;X-KEEP=1:old@example.com\r\nITEM1.X-ABLABEL:Newsletter\r\n");
        $baseline = $this->card("ITEM1.EMAIL;PROP-ID=e1:old@example.com\r\nITEM1.X-ABLABEL:Newsletter\r\n");
        $generated = $this->card("ITEM1.EMAIL;PROP-ID=e1:new@example.com\r\nITEM1.X-ABLABEL:Newsletter\r\n");

        $out = VCardInPlacePatcher::patch($stored, $baseline, $generated);

        $this->assertStringContainsString("ITEM1.EMAIL;PROP-ID=e1:new@example.com\r\n", $out);
        $this->assertStringContainsString("ITEM1.X-ABLABEL:Newsletter\r\n", $out);
        $this->assertStringNotContainsString('old@example.com', $out);
    }

    public function test_untouched_entries_stay_byte_identical(): void
    {
        $stored = $this->card("TEL;TYPE=CELL,VOICE,pref;PROP-ID=t1:+31 6 1\r\nX-CUSTOM;A=B:keep\r\nNOTE;PROP-ID=n1:old\r\n");
        $baseline = $this->card("TEL;TYPE=cell;PROP-ID=t1:+31 6 1\r\nNOTE;PROP-ID=n1:old\r\n");
        $generated = $this->card("TEL;TYPE=cell;PROP-ID=t1:+31 6 1\r\nNOTE;PROP-ID=n1:new\r\n");

        $out = VCardInPlacePatcher::patch($stored, $baseline, $generated);

        $this->assertStringContainsString("TEL;TYPE=CELL,VOICE,pref;PROP-ID=t1:+31 6 1\r\n", $out);
        $this->assertStringContainsString("X-CUSTOM;A=B:keep\r\n", $out);
        $this->assertStringContainsString("NOTE;PROP-ID=n1:new\r\n", $out);
    }

    public function test_removed_entry_takes_its_label_with_it(): void
    {
        $stored = $this->card("item1.EMAIL;PROP-ID=e1:a@example.com\r\nitem1.X-ABLABEL:Home\r\nEMAIL;PROP-ID=e2:b@example.com\r\n");
        $baseline = $this->card("item1.EMAIL;PROP-ID=e1:a@example.com\r\nitem1.X-ABLABEL:Home\r\nEMAIL;PROP-ID=e2:b@example.com\r\n");
        $generated = $this->card("EMAIL;PROP-ID=e2:b@example.com\r\n");

        $out = VCardInPlacePatcher::patch($stored, $baseline, $generated);

        $this->assertStringNotContainsString('a@example.com', $out);
        $this->assertStringNotContainsString('X-ABLABEL', $out);
        $this->assertStringContainsString('b@example.com', $out);
    }

    public function test_new_labelled_entry_gets_a_group_that_does_not_collide(): void
    {
        $stored = $this->card("ITEM1.EMAIL;PROP-ID=e1:a@example.com\r\nITEM1.X-ABLABEL:Home\r\n");
        $baseline = $stored;
        $generated = $this->card("ITEM1.EMAIL;PROP-ID=e1:a@example.com\r\nITEM1.X-ABLABEL:Home\r\nitem9.EMAIL;PROP-ID=e2;GROUP=item9:b@example.com\r\nitem9.X-ABLABEL:Work\r\n");

        $out = VCardInPlacePatcher::patch($stored, $baseline, $generated);

        $this->assertStringContainsString("item2.EMAIL;PROP-ID=e2:b@example.com\r\n", $out);
        $this->assertStringContainsString("item2.X-ABLABEL:Work\r\n", $out);
        $this->assertStringNotContainsString('GROUP=', $out);
    }

    public function test_stored_card_without_prop_ids_is_matched_on_content(): void
    {
        $stored = $this->card("EMAIL;TYPE=work:a@example.com\r\n");
        $baseline = $this->card("EMAIL;TYPE=work;PROP-ID=e1:a@example.com\r\n");
        $generated = $this->card("EMAIL;TYPE=home;PROP-ID=e1:a@example.com\r\n");

        $out = VCardInPlacePatcher::patch($stored, $baseline, $generated);

        $this->assertSame(1, substr_count($out, 'a@example.com'));
        $this->assertStringContainsString('TYPE=home', $out);
    }

    private function card(string $body): string
    {
        return "BEGIN:VCARD\r\nVERSION:3.0\r\nUID:u1\r\nFN:Test\r\nN:Test;;;;\r\n".$body."END:VCARD\r\n";
    }
}
