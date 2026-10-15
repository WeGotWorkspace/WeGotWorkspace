<?php

declare(strict_types=1);

namespace App\Http\Requests\Api\V1;

use App\Exceptions\ApiHttpException;
use App\Http\Middleware\AuthenticateWgwApi;
use App\Services\Collab\YjsBytes;
use App\Services\Collab\YjsPayloadException;
use App\Services\Notes\NoteRepository;
use App\Services\Notes\NoteTag;
use Illuminate\Contracts\Validation\Validator;
use Illuminate\Foundation\Http\FormRequest;

final class NotePatchRequest extends FormRequest
{
    /** Decoded Yjs bytes stashed before validation flattens the number list. */
    public const YJS_BYTES = 'note_yjs_bytes';

    public function authorize(): bool
    {
        return true;
    }

    /** @return array<string, mixed> */
    public function rules(): array
    {
        return [
            'notebookId' => ['sometimes', 'string', 'min:1'],
            'title' => ['sometimes', 'nullable', 'string', 'max:1024'],
            'body' => ['sometimes', 'nullable', 'string'],
            'categories' => ['sometimes', 'array'],
            'categories.*' => ['string', 'max:255'],
            'categoriesAdd' => ['sometimes', 'array'],
            'categoriesAdd.*' => ['string', 'max:255'],
            'categoriesRemove' => ['sometimes', 'array'],
            'categoriesRemove.*' => ['string', 'max:255'],
            'status' => ['sometimes', 'nullable', 'in:FINAL,CANCELLED'],
            // Cap is YjsBytes::MAX_BYTES. The list is removed in prepareForValidation
            // before Laravel flattens it; a 5 MiB number[] dotted into keys exhausts memory.
        ];
    }

    protected function prepareForValidation(): void
    {
        if (! $this->exists('yjs')) {
            return;
        }

        try {
            $bytes = YjsBytes::decode($this->input('yjs'));
        } catch (YjsPayloadException $e) {
            throw new ApiHttpException(
                $e->status,
                $e->status === 413
                    ? 'Yjs state exceeds the 5 MiB limit.'
                    : 'Yjs state must be a list of bytes from 0 to 255.',
                $e->status === 413 ? 'payload_too_large' : 'bad_request',
            );
        }

        $this->attributes->set(self::YJS_BYTES, $bytes);
        $this->json()->remove('yjs');
        $this->request->remove('yjs');
    }

    public function withValidator(Validator $validator): void
    {
        $validator->after(function (Validator $validator): void {
            if ($this->exists('categories') && ($this->exists('categoriesAdd') || $this->exists('categoriesRemove'))) {
                $validator->errors()->add(
                    'categories',
                    'Send categories or a tag delta, not both.',
                );
            }
            $this->rejectInvalidNewTags($validator, 'categories');
            $this->rejectInvalidNewTags($validator, 'categoriesAdd');
        });
    }

    /**
     * A new tag must match {@see NoteTag::INPUT_PATTERN}. A tag already stored
     * on the note may be sent back. Removals skip this check.
     */
    private function rejectInvalidNewTags(Validator $validator, string $field): void
    {
        $categories = $this->input($field);
        if (! is_array($categories)) {
            return;
        }
        $existing = null;
        foreach ($categories as $index => $tag) {
            if (! is_string($tag)) {
                continue;
            }
            if (preg_match(NoteTag::INPUT_PATTERN, $tag) === 1) {
                continue;
            }
            $existing ??= array_fill_keys($this->storedCategories(), true);
            $normalized = strtolower(trim($tag));
            if ($normalized !== '' && isset($existing[$normalized])) {
                continue;
            }
            $validator->errors()->add(
                $field.'.'.$index,
                'A tag may only use letters a-z and hyphen.',
            );
        }
    }

    /**
     * Legacy tags already on the note may be sent back. A new tag still has
     * to match {@see NoteTag::INPUT_PATTERN}.
     *
     * @return list<string>
     */
    private function storedCategories(): array
    {
        $noteId = $this->route('noteId');
        $principal = $this->attributes->get(AuthenticateWgwApi::PRINCIPAL_ATTRIBUTE);
        if (! is_string($noteId) || ! is_array($principal) || ! is_string($principal['username'] ?? null)) {
            return [];
        }
        try {
            $note = app(NoteRepository::class)->show($principal['username'], $noteId);
        } catch (ApiHttpException) {
            return [];
        }
        $categories = $note['categories'] ?? [];

        return is_array($categories) ? NoteTag::normalizeStored($categories) : [];
    }
}
