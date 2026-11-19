<?php

declare(strict_types=1);

namespace App\Http\Requests\Api\V1;

use App\Exceptions\ApiHttpException;
use App\Http\Requests\Api\V1\Concerns\ReadsCollaborationFrame;
use Illuminate\Foundation\Http\FormRequest;

/**
 * The live-text save of a task (#2208): the frame's document part is the
 * description, its `title` the title. Limits match `TaskPatchRequest`.
 */
final class TaskTextPutRequest extends FormRequest
{
    use ReadsCollaborationFrame;

    /** Decoded Yjs bytes. The frame tail is binary, so it never enters validation. */
    public const YJS_BYTES = 'task_text_yjs_bytes';

    public function authorize(): bool
    {
        return true;
    }

    /** @return array<string, mixed> */
    public function rules(): array
    {
        return [
            'markdown' => ['present', 'string', 'max:8192'],
            'title' => ['present', 'string', 'max:4096'],
        ];
    }

    public function title(): string
    {
        $title = $this->validated('title');
        if (! is_string($title) || trim($title) === '') {
            throw new ApiHttpException(422, 'A task needs a title.', 'title_required');
        }

        return $title;
    }

    public function description(): string
    {
        $description = $this->validated('markdown');

        return is_string($description) ? $description : '';
    }
}
