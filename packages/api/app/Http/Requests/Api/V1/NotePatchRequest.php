<?php

declare(strict_types=1);

namespace App\Http\Requests\Api\V1;

use App\Exceptions\ApiHttpException;
use App\Http\Middleware\AuthenticateWgwApi;
use App\Services\Notes\NoteRepository;
use App\Services\Notes\NoteTag;
use Illuminate\Contracts\Validation\Validator;
use Illuminate\Foundation\Http\FormRequest;

final class NotePatchRequest extends FormRequest
{
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
            'status' => ['sometimes', 'nullable', 'in:FINAL,CANCELLED'],
        ];
    }

    public function withValidator(Validator $validator): void
    {
        $validator->after(function (Validator $validator): void {
            $categories = $this->input('categories');
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
                    'categories.'.$index,
                    'A tag may only use letters a-z and hyphen.',
                );
            }
        });
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
