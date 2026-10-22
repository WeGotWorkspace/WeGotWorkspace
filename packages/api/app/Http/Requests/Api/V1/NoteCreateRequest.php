<?php

declare(strict_types=1);

namespace App\Http\Requests\Api\V1;

use App\Services\Notes\NoteTag;
use Illuminate\Foundation\Http\FormRequest;

final class NoteCreateRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    /** @return array<string, mixed> */
    public function rules(): array
    {
        return [
            'notebookId' => ['required', 'string', 'min:1'],
            'title' => ['sometimes', 'nullable', 'string', 'max:1024'],
            'body' => ['sometimes', 'nullable', 'string'],
            'categories' => ['sometimes', 'array'],
            'categories.*' => ['string', 'max:255', 'regex:'.NoteTag::INPUT_PATTERN],
            'status' => ['sometimes', 'nullable', 'in:FINAL,CANCELLED'],
            // The app picks the UID up front, so an offline create needs no
            // temporary id. Only a UUID is used (a slash would read as a Drive
            // room); anything else is ignored and the server mints, so an older
            // cached app that still sends `local-*` keeps working.
            'uid' => ['sometimes', 'string', 'max:200'],
        ];
    }
}
