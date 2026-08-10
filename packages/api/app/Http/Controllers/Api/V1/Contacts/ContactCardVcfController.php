<?php

declare(strict_types=1);

namespace App\Http\Controllers\Api\V1\Contacts;

use App\Http\Middleware\AuthenticateWgwApi;
use App\Services\Contacts\ContactCardRepository;
use Illuminate\Http\Request;
use Illuminate\Http\Response;

final class ContactCardVcfController
{
    public function __construct(private readonly ContactCardRepository $cards) {}

    public function __invoke(Request $request, string $cardId): Response
    {
        /** @var array{username: string, role: string} $principal */
        $principal = $request->attributes->get(AuthenticateWgwApi::PRINCIPAL_ATTRIBUTE);

        $result = $this->cards->exportVcard($principal['username'], $cardId);

        $filename = $this->safeFilename($result['uri']);

        return response($result['carddata'], 200, [
            'Content-Type' => 'text/vcard; charset=utf-8',
            'Content-Disposition' => 'attachment; filename="'.$filename.'"',
            'Cache-Control' => 'no-store',
        ]);
    }

    private function safeFilename(string $uri): string
    {
        $base = basename($uri);
        if ($base === '') {
            return 'contact.vcf';
        }

        $safe = preg_replace('/[^\w.\-]/', '_', $base) ?? 'contact';

        return str_ends_with($safe, '.vcf') ? $safe : $safe.'.vcf';
    }
}
