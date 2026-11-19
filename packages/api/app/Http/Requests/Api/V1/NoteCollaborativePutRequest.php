<?php

declare(strict_types=1);

namespace App\Http\Requests\Api\V1;

use App\Http\Requests\Api\V1\Concerns\ReadsCollaborationFrame;
use Illuminate\Foundation\Http\FormRequest;

final class NoteCollaborativePutRequest extends FormRequest
{
    use ReadsCollaborationFrame;

    /** Decoded Yjs bytes. The frame tail is binary, so it never enters validation. */
    public const YJS_BYTES = 'note_yjs_bytes';

    public function authorize(): bool
    {
        return true;
    }

    /** @return array<string, mixed> */
    public function rules(): array
    {
        return [
            // A title-only note saves an empty body (documentLen 0 per the
            // contract). `required` treated "" as missing and answered 400.
            'markdown' => ['present', 'string'],
            'title' => ['sometimes', 'string', 'max:1024'],
        ];
    }
}
