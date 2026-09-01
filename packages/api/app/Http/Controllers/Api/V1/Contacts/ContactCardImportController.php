<?php

declare(strict_types=1);

namespace App\Http\Controllers\Api\V1\Contacts;

use App\Exceptions\ApiHttpException;
use App\Http\Middleware\AuthenticateWgwApi;
use App\Http\Support\WgwOversizedPost;
use App\Services\Contacts\ContactCardRepository;
use Illuminate\Http\Exceptions\PostTooLargeException;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

final class ContactCardImportController
{
    public function __construct(private readonly ContactCardRepository $cards) {}

    public function __invoke(Request $request): JsonResponse
    {
        /** @var array{username: string, role: string} $principal */
        $principal = $request->attributes->get(AuthenticateWgwApi::PRINCIPAL_ATTRIBUTE);

        $addressBookId = $request->query('addressBookId');
        if (! is_string($addressBookId) || trim($addressBookId) === '') {
            throw new ApiHttpException(400, 'addressBookId is required.', 'bad_request');
        }

        $body = $request->getContent();
        if (! is_string($body) || trim($body) === '') {
            if (WgwOversizedPost::exceedsLimit($request)) {
                throw new PostTooLargeException;
            }
            throw new ApiHttpException(400, 'vCard body is required.', 'bad_request');
        }

        $result = $this->cards->importVcards(
            $principal['username'],
            $body,
            trim($addressBookId),
        );

        $status = count($result['list']) > 0 ? 201 : 400;

        return response()->json($result, $status);
    }
}
