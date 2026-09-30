<?php

declare(strict_types=1);

namespace App\Http\Controllers\Api\V1\Mail;

use App\Http\Middleware\AuthenticateWgwApi;
use App\Services\Mail\MailOperationService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

final class MailController
{
    public function __construct(private MailOperationService $mail) {}

    public function status(Request $request): JsonResponse
    {
        return $this->json(fn () => $this->mail->status($this->username($request)));
    }

    public function foldersIndex(Request $request): JsonResponse
    {
        return $this->json(fn () => $this->mail->listFolders($this->username($request)));
    }

    public function foldersStore(Request $request): JsonResponse
    {
        return $this->json(fn () => $this->mail->createFolder($this->username($request), $request->json()->all()));
    }

    public function foldersUpdate(Request $request): JsonResponse
    {
        return $this->json(fn () => $this->mail->moveFolder($this->username($request), $request->json()->all()));
    }

    public function foldersDestroy(Request $request): JsonResponse
    {
        return $this->json(fn () => $this->mail->deleteFolder($this->username($request), $request->json()->all()));
    }

    public function messagesIndex(Request $request): JsonResponse
    {
        return $this->json(fn () => $this->mail->listMessages($this->username($request), $request->query()));
    }

    public function messageAttachments(Request $request): JsonResponse
    {
        return $this->json(fn () => $this->mail->listMessageAttachments($this->username($request), $request->query()));
    }

    public function messageShow(Request $request): JsonResponse
    {
        return $this->json(fn () => $this->mail->getMessage($this->username($request), $request->query()));
    }

    public function messageUpdate(Request $request): JsonResponse
    {
        return $this->json(fn () => $this->mail->patchMessage($this->username($request), $request->json()->all()));
    }

    public function messageDestroy(Request $request): JsonResponse
    {
        return $this->json(fn () => $this->mail->deleteMessage($this->username($request), $request->query()));
    }

    public function messageAttachment(Request $request): Response
    {
        $download = $this->mail->downloadAttachment($this->username($request), $request->query());
        $ascii = preg_replace('/[^A-Za-z0-9._-]+/', '_', trim($download->filename)) ?: 'attachment';
        $star = rawurlencode(trim($download->filename) !== '' ? $download->filename : 'attachment');

        return response($download->bytes, 200, [
            'Content-Type' => $download->mime,
            'Cache-Control' => 'private, max-age=0',
            'X-Content-Type-Options' => 'nosniff',
            'Content-Length' => (string) strlen($download->bytes),
            'Content-Disposition' => 'attachment; filename="'.$ascii.'"; filename*=UTF-8\'\''.$star,
        ]);
    }

    public function move(Request $request): JsonResponse
    {
        return $this->json(fn () => $this->mail->moveMessage($this->username($request), $request->json()->all()));
    }

    public function send(Request $request): JsonResponse
    {
        return $this->json(fn () => $this->mail->send($this->username($request), $request->json()->all()));
    }

    public function draft(Request $request): JsonResponse
    {
        return $this->json(fn () => $this->mail->saveDraft($this->username($request), $request->json()->all()));
    }

    public function draftsStore(Request $request): JsonResponse
    {
        return $this->draft($request);
    }

    public function messagesStore(Request $request): JsonResponse
    {
        return $this->send($request);
    }

    public function messageShowById(Request $request, string $messageId): JsonResponse
    {
        return $this->json(fn () => $this->mail->getMessage(
            $this->username($request),
            $this->messageQueryFromId($messageId, $request->query()),
        ));
    }

    public function messageUpdateById(Request $request, string $messageId): JsonResponse
    {
        $body = $request->json()->all();
        $body = array_merge($this->messageQueryFromId($messageId, []), $body);

        return $this->json(fn () => $this->mail->patchMessage($this->username($request), $body));
    }

    public function messageDestroyById(Request $request, string $messageId): JsonResponse
    {
        return $this->json(fn () => $this->mail->deleteMessage(
            $this->username($request),
            $this->messageQueryFromId($messageId, $request->query()),
        ));
    }

    public function messageAttachmentsById(Request $request, string $messageId): JsonResponse
    {
        return $this->json(fn () => $this->mail->listMessageAttachments(
            $this->username($request),
            $this->messageQueryFromId($messageId, $request->query()),
        ));
    }

    public function messageAttachmentById(Request $request, string $messageId, string $attachmentId): Response
    {
        $query = $this->messageQueryFromId($messageId, $request->query());
        $query['part'] = $attachmentId;

        $download = $this->mail->downloadAttachment($this->username($request), $query);
        $ascii = preg_replace('/[^A-Za-z0-9._-]+/', '_', trim($download->filename)) ?: 'attachment';
        $star = rawurlencode(trim($download->filename) !== '' ? $download->filename : 'attachment');

        return response($download->bytes, 200, [
            'Content-Type' => $download->mime,
            'Cache-Control' => 'private, max-age=0',
            'X-Content-Type-Options' => 'nosniff',
            'Content-Length' => (string) strlen($download->bytes),
            'Content-Disposition' => 'attachment; filename="'.$ascii.'"; filename*=UTF-8\'\''.$star,
        ]);
    }

    /**
     * @param  array<string, mixed>  $query
     * @return array<string, mixed>
     */
    private function messageQueryFromId(string $messageId, array $query): array
    {
        if (isset($query['folder'], $query['uid'])) {
            return $query;
        }

        if (str_contains($messageId, ':')) {
            [$folder, $uid] = explode(':', $messageId, 2);
            $query['folder'] = $folder;
            $query['uid'] = $uid;
        }

        return $query;
    }

    /**
     * @param  callable(): array<string, mixed>  $callback
     */
    private function json(callable $callback): JsonResponse
    {
        return response()->json($callback());
    }

    private function username(Request $request): string
    {
        /** @var array{username: string, role: string} $principal */
        $principal = $request->attributes->get(AuthenticateWgwApi::PRINCIPAL_ATTRIBUTE);

        return $principal['username'];
    }
}
